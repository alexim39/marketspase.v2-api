import {
  ConflictException, ForbiddenException, NotFoundException, ValidationException,
} from '../../../shared/domain/AppError.js';
import { LEADERSHIP_LEVELS, createCommentEntity, createPostEntity, extractMentions } from '../domain/Post.entity.js';
import { lenientRole } from '../../identity-access/domain/PartnerRole.js';
import { isAncestor } from '../../network/infrastructure/Network.mongo.repository.js';
import { NOTIFICATION_EVENTS, mentionCreated } from '../../notifications/domain/NotificationEvents.js';
import { publicIdFromUrl } from '../../settings/infrastructure/CloudinaryClient.js';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pageOf = (limit) => Math.min(Math.max(Number(limit) || 20, 1), 50);

/** Legacy on-disk attachments live under `src/uploads/community/`. */
const LEGACY_FILE_RE = /^\/uploads\/community\/([A-Za-z0-9_.-]+)$/;
const legacyUploadsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'uploads', 'community',
);

/**
 * Destroy every attachment behind a deleted post — Cloudinary assets by
 * public id (video assets need `resource_type: video`), legacy local
 * files by unlink. Best-effort per asset: one missing file never fails
 * the delete. Returns the destroy count for tests/logs.
 */
export async function destroyPostMedia(media, attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) return { destroyed: 0 };
  const jobs = list.map(async (a) => {
    try {
      const url = String(a?.url ?? '');
      const mime = String(a?.mime ?? '');
      const legacy = LEGACY_FILE_RE.exec(url);
      if (legacy) {
        await unlink(path.join(legacyUploadsDir, legacy[1]));
        return true;
      }
      const publicId = publicIdFromUrl(url);
      if (!publicId || !media?.destroy) return false;
      await media.destroy(publicId, { resourceType: mime.startsWith('video/') ? 'video' : 'image' });
      return true;
    } catch {
      return false;
    }
  });
  const results = await Promise.all(jobs);
  return { destroyed: results.filter(Boolean).length };
}

async function viewerLevel(progress, viewerId) {
  if (!progress?.levelsFor) return null;
  const map = await progress.levelsFor([String(viewerId)]);
  return map[String(viewerId)] ?? null;
}

async function visible(post, viewerId, viewerIsLeader, { network }) {
  if (post.scope === 'global') return true;
  if (String(post.authorId) === String(viewerId)) return true;
  if (post.scope === 'team') return isAncestor(network, post.authorId, viewerId);
  if (post.scope === 'leadership') return viewerIsLeader;
  return false;
}

/** Cursor feed: global + visible team/leadership posts, newest first. */
export class GetFeedUseCase {
  /** @param {{community, network, progress}} deps */
  constructor({ community, network, progress }) {
    Object.assign(this, { community, network, progress });
  }

  async execute({ viewerId, before, limit = 20, now = new Date() }) {
    const lim = pageOf(limit);
    const cursor = before ? new Date(before) : new Date(now);
    const [reported, level] = await Promise.all([
      this.community.reportedByMe(viewerId),
      viewerLevel(this.progress, viewerId),
    ]);
    const viewerIsLeader = LEADERSHIP_LEVELS.includes(level);
    // Over-fetch, then visibility-filter (team checks walk the chain).
    const candidates = await this.community.recentCandidates(cursor, lim * 3 + 10, [...reported]);
    const t = new Date(now).getTime();
    // Expired pins drop back into chronological order (in-memory; the
    // writer clears them on next pin/unpin, no sweep job needed at this scale).
    for (const c of candidates) {
      if (c.pinned && c.pinnedUntil && new Date(c.pinnedUntil).getTime() <= t) c.pinned = false;
    }
    const visiblePosts = [];
    for (const post of candidates) {
      if (visiblePosts.length >= lim) break;
      // eslint-disable-next-line no-await-in-loop
      if (await visible(post, viewerId, viewerIsLeader, this)) visiblePosts.push(post);
    }
    const ids = visiblePosts.map((p) => p.id);
    const [likes, comments, liked, saved, savedCounts, authors] = await Promise.all([
      this.community.likeCounts('post', ids),
      this.community.commentCounts(ids),
      this.community.likedByMe('post', ids, viewerId),
      this.community.savedByMe(ids, viewerId),
      this.community.savedCounts(ids),
      this.community.authorLabels(visiblePosts.map((p) => p.authorId)),
    ]);
    const items = visiblePosts.map((p) => ({
      ...p,
      author: authors[p.authorId] ?? null,
      likeCount: likes[p.id] ?? 0,
      commentCount: comments[p.id] ?? 0,
      likedByMe: liked.has(p.id),
      savedByMe: saved.has(p.id),
      saveCount: savedCounts[p.id] ?? 0,
    }));
    const last = visiblePosts[visiblePosts.length - 1];
    return {
      items,
      nextCursor: last ? last.createdAt : null,
      viewerLevel: level,
    };
  }
}

export class CreatePostUseCase {
  /** @param {{community, events?}} deps (events optional — mention fan-out subscribes) */
  constructor({ community, events = null }) {
    Object.assign(this, { community, events });
  }

  async execute({ authorId, ...input }) {
    const entity = createPostEntity(input);
    const post = await this.community.createPost({
      ...entity,
      authorId,
      auto: false,
      mentions: extractMentions(`${entity.title} ${entity.body}`),
    });
    // Business modules emit facts; delivery lives in the notification slice.
    if (this.events && (post?.mentions ?? []).length > 0) {
      await this.events.emit(
        NOTIFICATION_EVENTS.MENTION_CREATED,
        mentionCreated({
          authorId,
          sourceType: 'post',
          sourceId: String(post.id ?? post._id),
          handles: post.mentions,
          text: `${entity.title} ${entity.body}`,
        }),
      ).catch(() => null);
    }
    return post;
  }
}

export class ToggleLikeUseCase {
  /** @param {{community, network, progress}} deps (visibility-checked; exactly one of postId/commentId) */
  constructor({ community, network, progress }) {
    Object.assign(this, { community, network, progress });
  }

  async execute({ partnerId, postId, commentId }) {
    if ((postId && commentId) || (!postId && !commentId)) {
      throw new ValidationException('Provide exactly one of postId, commentId');
    }
    let post = null;
    let targetType = 'post';
    let targetId = postId;
    if (commentId) {
      const comment = await this.community.findCommentById(commentId);
      if (!comment) throw new NotFoundException('Comment not found');
      post = await this.community.findPostById(comment.postId);
      if (!post) throw new NotFoundException('Post not found');
      targetType = 'comment';
      targetId = commentId;
    } else {
      post = await this.community.findPostById(postId);
      if (!post) throw new NotFoundException('Post not found');
    }
    const level = await viewerLevel(this.progress, partnerId);
    if (!(await visible(post, partnerId, LEADERSHIP_LEVELS.includes(level), this))) {
      throw new ForbiddenException('You cannot interact with this post');
    }
    return this.community.toggleLike(targetType, targetId, partnerId);
  }
}

export class ListCommentsUseCase {
  /** @param {{community, network, progress}} deps (visibility-checked) */
  constructor({ community, network, progress }) {
    Object.assign(this, { community, network, progress });
  }

  async execute({ partnerId, postId, limit = 100 }) {
    const post = await this.community.findPostById(postId);
    if (!post) throw new NotFoundException('Post not found');
    const level = await viewerLevel(this.progress, partnerId);
    if (!(await visible(post, partnerId, LEADERSHIP_LEVELS.includes(level), this))) {
      throw new ForbiddenException('You cannot view these comments');
    }
    const comments = await this.community.listComments(postId, Math.min(Math.max(Number(limit) || 100, 1), 200));
    const ids = comments.map((c) => c.id);
    const [likes, liked, authors] = await Promise.all([
      this.community.likeCounts('comment', ids),
      this.community.likedByMe('comment', ids, partnerId),
      this.community.authorLabels(comments.map((c) => c.authorId)),
    ]);
    return comments.map((c) => ({
      ...c,
      author: authors[c.authorId] ?? null,
      likeCount: likes[c.id] ?? 0,
      likedByMe: liked.has(c.id),
    }));
  }
}

export class AddCommentUseCase {
  /** @param {{community, network, progress, events?}} deps (visibility-checked; events optional) */
  constructor({ community, network, progress, events = null }) {
    Object.assign(this, { community, network, progress, events });
  }

  async execute({ partnerId, postId, ...input }) {
    const post = await this.community.findPostById(postId);
    if (!post) throw new NotFoundException('Post not found');
    const level = await viewerLevel(this.progress, partnerId);
    if (!(await visible(post, partnerId, LEADERSHIP_LEVELS.includes(level), this))) {
      throw new ForbiddenException('You cannot comment on this post');
    }
    const { body } = createCommentEntity(input);
    const comment = await this.community.addComment({
      postId,
      authorId: partnerId,
      body,
      parentId: input.parentId ?? null,
      mentions: extractMentions(body),
    });
    if (this.events && (comment?.mentions ?? []).length > 0) {
      await this.events.emit(
        NOTIFICATION_EVENTS.MENTION_CREATED,
        mentionCreated({
          authorId: partnerId,
          sourceType: 'comment',
          sourceId: String(comment.id ?? comment._id),
          handles: comment.mentions,
          text: body,
        }),
      ).catch(() => null);
    }
    return comment;
  }
}

export class ToggleSaveUseCase {
  /** @param {{community}} deps */
  constructor({ community }) {
    this.community = community;
  }

  async execute({ partnerId, postId }) {
    const post = await this.community.findPostById(postId);
    if (!post) throw new NotFoundException('Post not found');
    return this.community.toggleSave(partnerId, postId);
  }
}

export class ReportPostUseCase {
  /** @param {{community}} deps */
  constructor({ community }) {
    this.community = community;
  }

  async execute({ partnerId, postId, reason = '' }) {
    const post = await this.community.findPostById(postId);
    if (!post) throw new NotFoundException('Post not found');
    return this.community.report(partnerId, postId, String(reason ?? '').slice(0, 300));
  }
}

/** Authors edit their own posts (title/body/link only — kind, scope and attachments stay as posted). */
export class UpdatePostUseCase {
  /** @param {{community, events?}} deps (events optional — mention fan-out subscribes) */
  constructor({ community, events = null }) {
    Object.assign(this, { community, events });
  }

  async execute({ partnerId, postId, title, body, link }) {
    const post = await this.community.findPostById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (String(post.authorId) !== String(partnerId)) throw new ForbiddenException('Only the author can edit');
    if (post.auto) throw new ForbiddenException('Automatic posts cannot be edited');
    const patch = {
      ...(title !== undefined ? { title: String(title).trim().slice(0, 120) } : {}),
      ...(body !== undefined ? { body: String(body).trim() } : {}),
      ...(link !== undefined ? { link: String(link).trim().slice(0, 500) } : {}),
    };
    if (patch.body !== undefined && patch.body.length < 1) throw new ValidationException('Post body cannot be empty');
    const nextTitle = patch.title ?? post.title ?? '';
    const nextBody = patch.body ?? post.body ?? '';
    const updated = await this.community.updatePost(postId, {
      ...patch,
      mentions: extractMentions(`${nextTitle} ${nextBody}`),
    });
    if (this.events && (updated?.mentions ?? []).length > 0) {
      await this.events.emit(
        NOTIFICATION_EVENTS.MENTION_CREATED,
        mentionCreated({
          authorId: partnerId,
          sourceType: 'post',
          sourceId: String(updated.id ?? updated._id),
          handles: updated.mentions,
          text: `${nextTitle} ${nextBody}`,
        }),
      ).catch(() => null);
    }
    return updated;
  }
}

/** Authors delete their own posts (comments, likes, saves and reports go too). */
export class DeletePostUseCase {
  /** @param {{community, media?}} deps (media optional — destroys Cloudinary/legacy attachments) */
  constructor({ community, media = null }) {
    this.community = community;
    this.media = media;
  }

  async execute({ partnerId, postId }) {
    const post = await this.community.findPostById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (String(post.authorId) !== String(partnerId)) throw new ForbiddenException('Only the author can delete');
    const result = await this.community.deletePostCascade(postId);
    await destroyPostMedia(this.media, post.attachments).catch(() => null);
    return result;
  }
}
export class PinPostUseCase {
  /** Max pinned posts per scope — keeps the top calm. */
  static MAX_PINS = 3;
  /** Pin-eligible kinds — announcements plus key events. */
  static PINNABLE = ['announcement', 'event'];
  /** @param {{community, partners?}} deps (partners resolves admin override) */
  constructor({ community, partners = null }) {
    Object.assign(this, { community, partners });
  }

  async execute({ partnerId, postId, pinned, pinnedUntil = null, now = new Date() }) {
    const post = await this.community.findPostById(postId);
    if (!post) throw new NotFoundException('Post not found');
    const want = pinned === true;
    if (!want) {
      // Unpin is the author's or an admin's call — same gate, no cap check.
      if (!(await this.canPin(partnerId, post))) throw new ForbiddenException('Only the author or an admin can unpin');
      return this.community.setPinned(postId, false);
    }
    if (!PinPostUseCase.PINNABLE.includes(post.kind)) {
      throw new ForbiddenException('Only announcements and events can be pinned');
    }
    if (!(await this.canPin(partnerId, post))) {
      throw new ForbiddenException('Only the author or an admin can pin');
    }
    let until = null;
    if (pinnedUntil !== null && pinnedUntil !== undefined && String(pinnedUntil).trim() !== '') {
      until = new Date(pinnedUntil);
      if (Number.isNaN(until.getTime())) throw new ValidationException('Invalid pin expiry');
      if (until.getTime() <= new Date(now).getTime()) throw new ValidationException('Pin expiry must be in the future');
    }
    const pinnedCount = await this.community.countPinned(post.scope, postId, now).catch(() => 0);
    if (pinnedCount >= PinPostUseCase.MAX_PINS) {
      throw new ConflictException('Pin limit reached (3) — unpin one first');
    }
    return this.community.setPinned(postId, true, until);
  }

  async canPin(partnerId, post) {
    if (String(post.authorId) === String(partnerId)) return true;
    if (!this.partners?.findById) return false;
    try {
      const me = await this.partners.findById(partnerId).catch(() => null);
      const row = me && typeof me.lean === 'function' ? await me.lean().catch(() => me) : me;
      return lenientRole(row?.role) === 'admin';
    } catch {
      return false;
    }
  }
}

/** Username directory for @mention autocomplete (safe fields only). */
export class DirectoryUseCase {
  /** @param {{community}} deps */
  constructor({ community }) {
    this.community = community;
  }

  async execute({ query, limit = 10 }) {
    return this.community.searchDirectory(query, limit);
  }
}

export class CommunityAnalyticsUseCase {  /** @param {{community}} deps */
  constructor({ community }) {
    this.community = community;
  }

  async execute({ days = 7 } = {}) {
    const d = Math.min(Math.max(Number(days) || 7, 1), 90);
    const since = new Date(Date.now() - d * 86400000);
    const { posts, likes, comments } = await this.community.engagementSince(since);
    const byKind = {};
    const byAuthor = {};
    for (const row of posts) {
      byKind[row._id.kind] = (byKind[row._id.kind] ?? 0) + row.count;
      byAuthor[String(row._id.author)] = (byAuthor[String(row._id.author)] ?? 0) + row.count;
    }
    const topIds = Object.entries(byAuthor).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
    const labels = await this.community.authorLabels(topIds);
    return {
      days: d,
      posts: posts.reduce((s, r) => s + r.count, 0),
      likes,
      comments,
      byKind,
      topContributors: topIds.map((id) => ({ id, ...(labels[id] ?? { username: '', name: '' }), posts: byAuthor[id] })),
    };
  }
}

/**
 * System recognition — called by progression (promotions) and training
 * (certificates). Global scope so the whole community celebrates.
 */
export class RecognitionUseCases {
  /** @param {{community}} deps */
  constructor({ community }) {
    this.community = community;
  }

  async promotion(partnerId, from, to, authorName) {
    return this.community.createPost({
      authorId: partnerId,
      kind: 'recognition',
      title: `${authorName} is now ${String(to).replace(/_/g, ' ')}`,
      body: `Promoted from ${String(from).replace(/_/g, ' ')} — congratulate them.`,
      link: '',
      scope: 'global',
      auto: true,
      refType: 'promotion',
      refId: String(to),
    });
  }

  async certificate(partnerId, courseId, courseTitle, authorName) {
    return this.community.createPost({
      authorId: partnerId,
      kind: 'recognition',
      title: `${authorName} earned ${courseTitle}`,
      body: 'Certified and one step closer on the ladder.',
      link: '',
      scope: 'global',
      auto: true,
      refType: 'certificate',
      refId: String(courseId),
    });
  }

  async goal(partnerId, goalId, goalTitle, authorName) {
    return this.community.createPost({
      authorId: partnerId,
      kind: 'recognition',
      title: `${authorName} smashed a goal: ${goalTitle}`,
      body: 'Goal achieved — congratulate them.',
      link: '',
      scope: 'global',
      auto: true,
      refType: 'goal',
      refId: String(goalId),
    });
  }
}
