import mongoose from 'mongoose';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';

const postSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    kind: { type: String, enum: ['standard', 'announcement', 'recognition', 'training', 'event'], required: true, index: true },
    title: { type: String, default: '', maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },
    link: { type: String, default: '', maxlength: 500 },
    scope: { type: String, enum: ['global', 'team', 'leadership'], required: true, index: true },
    pinned: { type: Boolean, default: false },
    pinnedUntil: { type: Date, default: null, index: true },
    auto: { type: Boolean, default: false, index: true },
    refType: { type: String, default: '' },
    refId: { type: String, default: '' },
    mentions: { type: [String], default: [] },
    attachments: {
      type: [{
        url: { type: String, required: true },
        mime: { type: String, required: true },
        size: { type: Number, required: true },
        _id: false,
      }],
      default: [],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
postSchema.index({ scope: 1, createdAt: -1 });

const commentSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    body: { type: String, required: true, maxlength: 1000 },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityComment', default: null },
    mentions: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
commentSchema.index({ postId: 1, createdAt: 1 });

const likeSchema = new mongoose.Schema(
  {
    targetType: { type: String, enum: ['post', 'comment'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
likeSchema.index({ targetType: 1, targetId: 1, partnerId: 1 }, { unique: true });

const savedSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
savedSchema.index({ partnerId: 1, postId: 1 }, { unique: true });

const reportSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost', required: true },
    reason: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
reportSchema.index({ partnerId: 1, postId: 1 }, { unique: true });

export const PostModel = mongoose.models.CommunityPost ?? mongoose.model('CommunityPost', postSchema);
export const CommentModel = mongoose.models.CommunityComment ?? mongoose.model('CommunityComment', commentSchema);
export const LikeModel = mongoose.models.CommunityLike ?? mongoose.model('CommunityLike', likeSchema);
export const SavedModel = mongoose.models.CommunitySaved ?? mongoose.model('CommunitySaved', savedSchema);
export const PostReportModel = mongoose.models.CommunityReport ?? mongoose.model('CommunityReport', reportSchema);

const oid = (v) => String(v);
// Feed enrichment hands us string ids, but the _id/targetId/postId fields
// are ObjectIds — $match inside aggregate() does not cast them the way
// find() does, so uncast strings silently match nothing (all counts 0).
// Coerce explicitly; new ObjectId(existingObjectId) is a safe no-op.
const toObjectId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));
const oidList = (ids) => (ids ?? []).map(toObjectId);
const shaped = (o) => {
  if (!o) return null;
  const out = { ...o, id: oid(o._id) };
  if (out.authorId !== undefined) out.authorId = oid(out.authorId);
  if (out.postId !== undefined) out.postId = oid(out.postId);
  return out;
};

/** Mongo implementation of the community store. Reads use `.lean()`. */
export class MongoCommunityStore {
  async createPost(data) {
    return shaped((await PostModel.create(data)).toObject());
  }

  async findPostById(id) {
    return shaped(await PostModel.findById(id).lean());
  }

  /** Existing auto-post for a ref (dedupe for goal/promotion celebrations). */
  async findAutoPost(refType, refId) {
    if (!refType || !refId) return null;
    return shaped(await PostModel.findOne({ refType: String(refType), refId: String(refId) }).lean());
  }

  async findCommentById(id) {
    return shaped(await CommentModel.findById(id).lean());
  }

  /** Username directory for @mention autocomplete (safe fields only). */
  async searchDirectory(query, limit = 10) {
    const q = String(query ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (q.length < 2) return [];
    const docs = await PartnersModel.find({ username: { $regex: `^${q}`, $options: 'i' } })
      .select('username name surname')
      .limit(Math.min(Math.max(Number(limit) || 10, 1), 20))
      .lean();
    return docs.map((d) => ({
      username: d.username,
      name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
    }));
  }

  /**
   * Keyword search over posts the requester may see: global scope plus
   * team posts by the requester or their bounded downline. Newest first.
   */
  async searchPosts({ authorIds = [], q, limit = 5 }) {
    const clean = String(q ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (clean.length < 2) return [];
    const re = new RegExp(clean, 'i');
    const ids = (authorIds ?? []).map(String);
    const docs = await PostModel.find({
      $and: [
        { $or: [{ title: re }, { body: re }] },
        {
          $or: [
            { scope: 'global' },
            { scope: 'team', authorId: { $in: ids } },
            { authorId: { $in: ids } },
          ],
        },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 5, 1), 10))
      .lean();
    return docs.map(shaped);
  }

  /** Newest-first candidates (visibility filtered in the use case). */
  async recentCandidates(before, limit = 60, excludeIds = []) {
    const filter = before ? { createdAt: { $lt: before } } : {};
    if (excludeIds.length > 0) filter._id = { $nin: excludeIds };
    // Pinned announcements surface first within the window.
    const docs = await PostModel.find(filter).sort({ pinned: -1, createdAt: -1 }).limit(limit).lean();
    return docs.map(shaped);
  }

  async setPinned(id, pinned, pinnedUntil = null) {
    const doc = await PostModel.findByIdAndUpdate(
      id,
      { $set: { pinned, pinnedUntil: pinned ? pinnedUntil : null } },
      { new: true },
    ).lean();
    return shaped(doc);
  }

  /** Active pins in a scope (unexpired) — the 3-pin cap counts these. */
  async countPinned(scope, excludeId = null, now = new Date()) {
    const filter = {
      scope,
      pinned: true,
      $or: [{ pinnedUntil: null }, { pinnedUntil: { $gt: now } }],
    };
    if (excludeId) filter._id = { $ne: excludeId };
    return PostModel.countDocuments(filter);
  }

  async updatePost(id, patch) {
    const doc = await PostModel.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean();
    return shaped(doc);
  }

  /** Author delete — post plus its comments, likes, saves and reports. */
  async deletePostCascade(id) {
    const comments = await CommentModel.find({ postId: id }).select('_id').lean();
    const commentIds = comments.map((c) => c._id);
    await Promise.all([
      CommentModel.deleteMany({ postId: id }),
      LikeModel.deleteMany({
        $or: [
          { targetType: 'post', targetId: id },
          ...(commentIds.length > 0 ? [{ targetType: 'comment', targetId: { $in: commentIds } }] : []),
        ],
      }),
      SavedModel.deleteMany({ postId: id }),
      PostReportModel.deleteMany({ postId: id }),
      PostModel.deleteOne({ _id: id }),
    ]);
    return { deleted: true };
  }

  async toggleLike(targetType, targetId, partnerId) {
    const existing = await LikeModel.findOne({ targetType, targetId, partnerId }).lean();
    if (existing) {
      await LikeModel.deleteOne({ _id: existing._id });
      return { liked: false };
    }
    await LikeModel.create({ targetType, targetId, partnerId });
    return { liked: true };
  }

  async likeCounts(targetType, targetIds) {
    if (targetIds.length === 0) return {};
    const rows = await LikeModel.aggregate([
      { $match: { targetType, targetId: { $in: oidList(targetIds) } } },
      { $group: { _id: '$targetId', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [oid(r._id), r.count]));
  }

  async likedByMe(targetType, targetIds, partnerId) {
    if (targetIds.length === 0) return new Set();
    const rows = await LikeModel.find({ targetType, targetId: { $in: targetIds }, partnerId })
      .select('targetId')
      .lean();
    return new Set(rows.map((r) => oid(r.targetId)));
  }

  async addComment({ postId, authorId, body, parentId, mentions }) {
    return shaped((await CommentModel.create({ postId, authorId, body, parentId: parentId ?? null, mentions: mentions ?? [] })).toObject());
  }

  async listComments(postId, limit = 100) {
    const docs = await CommentModel.find({ postId }).sort({ createdAt: 1 }).limit(limit).lean();
    return docs.map(shaped);
  }

  async commentCounts(postIds) {
    if (postIds.length === 0) return {};
    const rows = await CommentModel.aggregate([
      { $match: { postId: { $in: oidList(postIds) } } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [oid(r._id), r.count]));
  }

  async toggleSave(partnerId, postId) {
    const existing = await SavedModel.findOne({ partnerId, postId }).lean();
    if (existing) {
      await SavedModel.deleteOne({ _id: existing._id });
      return { saved: false };
    }
    await SavedModel.create({ partnerId, postId });
    return { saved: true };
  }

  async savedByMe(postIds, partnerId) {
    if (postIds.length === 0) return new Set();
    const rows = await SavedModel.find({ postId: { $in: postIds }, partnerId }).select('postId').lean();
    return new Set(rows.map((r) => oid(r.postId)));
  }

  async savedCounts(postIds) {
    if (postIds.length === 0) return {};
    const rows = await SavedModel.aggregate([
      { $match: { postId: { $in: oidList(postIds) } } },
      { $group: { _id: '$postId', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [oid(r._id), r.count]));
  }

  async report(partnerId, postId, reason) {
    await PostReportModel.updateOne(
      { partnerId, postId },
      { $setOnInsert: { partnerId, postId, reason } },
      { upsert: true },
    );
    return { reported: true };
  }

  async reportedByMe(partnerId) {
    const rows = await PostReportModel.find({ partnerId }).select('postId').lean();
    return new Set(rows.map((r) => oid(r.postId)));
  }

  /**
   * Admin moderation queue — reported posts with counts, newest reports
   * first. Deleted posts drop out via the $lookup filter. Bounded.
   */
  async reportedQueue({ limit = 25, skip = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const [rows, totalAgg] = await Promise.all([
      PostReportModel.aggregate([
        {
          $group: {
            _id: '$postId',
            reports: { $sum: 1 },
            latestAt: { $max: '$createdAt' },
            reasons: { $addToSet: '$reason' },
          },
        },
        { $sort: { reports: -1, latestAt: -1 } },
        { $skip: sk },
        { $limit: lim },
        {
          $lookup: {
            from: PostModel.collection.name,
            localField: '_id',
            foreignField: '_id',
            as: 'post',
          },
        },
        { $match: { 'post.0': { $exists: true } } },
        {
          $lookup: {
            from: PartnersModel.collection.name,
            localField: 'post.authorId',
            foreignField: '_id',
            as: 'author',
          },
        },
        {
          $project: {
            postId: '$_id',
            reports: 1,
            latestAt: 1,
            reasons: { $slice: ['$reasons', 5] },
            post: { $arrayElemAt: ['$post', 0] },
            author: { $arrayElemAt: ['$author', 0] },
          },
        },
      ]),
      PostReportModel.aggregate([
        { $group: { _id: '$postId' } },
        { $count: 'n' },
      ]),
    ]);
    return {
      items: rows.map((r) => ({
        postId: oid(r.postId),
        reports: r.reports,
        latestAt: r.latestAt,
        reasons: (r.reasons ?? []).filter(Boolean),
        excerpt: String(r.post?.body ?? '').slice(0, 280),
        kind: r.post?.kind ?? null,
        authorId: r.post?.authorId ? oid(r.post.authorId) : null,
        authorUsername: r.author?.username ?? null,
        postedAt: r.post?.createdAt ?? null,
      })),
      total: totalAgg[0]?.n ?? 0,
      limit: lim,
      skip: sk,
    };
  }

  /** Admin dismiss — clears reports, keeps the post. */
  async dismissReports(postId) {
    const res = await PostReportModel.deleteMany({ postId });
    return { dismissed: res.deletedCount ?? 0 };
  }

  /** Lowercase username for mention matching (null when unknown). */
  async findUsername(partnerId) {
    const doc = await PartnersModel.findById(partnerId).select('username').lean();
    return doc?.username ? String(doc.username).toLowerCase() : null;
  }

  /**
   * Resolve @mention handles to partners (exact, case-insensitive).
   * Safe fields + email only — the fan-out needs somewhere to send.
   */
  async findPartnersByUsernames(handles) {
    const clean = [...new Set((handles ?? []).map((h) => String(h ?? '').toLowerCase().trim()))].filter(Boolean);
    if (clean.length === 0) return [];
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const docs = await PartnersModel.find({
      $or: clean.map((h) => ({ username: { $regex: `^${escape(h)}$`, $options: 'i' } })),
    }).select('username name surname email phone').lean();
    return docs.map((d) => ({
      partnerId: oid(d._id),
      username: String(d.username ?? '').toLowerCase(),
      name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
      email: d.email ?? null,
      phone: d.phone ?? null,
    }));
  }

  /**
   * Recent posts + comments mentioning `username` (already lowercase).
   * Normalized for the notification feed builder; visibility is NOT
   * checked here — the feed filters to visible posts only.
   */
  async findMentionsOf(username, since, limit = 20) {
    const handle = String(username ?? '').toLowerCase();
    if (!handle) return [];
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const [posts, comments] = await Promise.all([
      PostModel.find({ mentions: handle, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .limit(lim)
        .lean(),
      CommentModel.find({ mentions: handle, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .limit(lim)
        .lean(),
    ]);
    const out = [
      ...posts.map((p) => ({
        sourceType: 'post',
        sourceId: oid(p._id),
        postId: oid(p._id),
        authorId: oid(p.authorId),
        excerpt: p.title ? `${p.title} — ${p.body}` : p.body,
        createdAt: p.createdAt,
      })),
      ...comments.map((c) => ({
        sourceType: 'comment',
        sourceId: oid(c._id),
        postId: oid(c.postId),
        authorId: oid(c.authorId),
        excerpt: c.body,
        createdAt: c.createdAt,
      })),
    ];
    out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return out.slice(0, lim);
  }

  async authorLabels(ids) {
    const uniq = [...new Set(ids.map(String))].filter(Boolean);
    if (uniq.length === 0) return {};
    const docs = await PartnersModel.find({ _id: { $in: uniq } }).select('username name surname profileImage').lean();
    return Object.fromEntries(docs.map((d) => [oid(d._id), {
      username: d.username,
      name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
      profileImage: d.profileImage ?? null,
    }]));
  }

  /** Posts + comments authored since `since` — leadership footprint. */
  async countPostsByAuthorSince(authorId, since) {
    const [posts, comments] = await Promise.all([
      PostModel.countDocuments({ authorId, createdAt: { $gte: since } }),
      CommentModel.countDocuments({ authorId, createdAt: { $gte: since } }),
    ]);
    return posts + comments;
  }

  /** Raw engagement rows for analytics (bounded window). */
  async engagementSince(since) {
    const [posts, likes, comments] = await Promise.all([
      PostModel.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { kind: '$kind', author: '$authorId' }, count: { $sum: 1 } } },
      ]),
      LikeModel.countDocuments({ createdAt: { $gte: since } }),
      CommentModel.countDocuments({ createdAt: { $gte: since } }),
    ]);
    return { posts, likes, comments };
  }
}
