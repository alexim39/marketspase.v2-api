import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import {
  extractYouTubeId,
  thumbnailUrl as youtubeThumbnail,
  watchUrl as youtubeWatchUrl,
} from '../../tutorials/domain/Tutorial.youtube.js';
import {
  applyHeartbeat,
  completionPercent,
  computeEngagement,
  MIN_HEARTBEAT_GAP_MS,
  normalizeCommentBody,
  normalizeWeekStart,
  weekEndFor,
} from '../domain/WeeklyVideo.domain.js';
import {
  shapeComment,
  shapeProgress,
  shapeWeeklyVideo,
} from '../infrastructure/WeeklyVideo.mongo.repository.js';

const cleanTitle = (value) => {
  const title = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (title.length < 3) throw new ValidationException('Title must be at least 3 characters');
  if (title.length > 120) throw new ValidationException('Title must be 120 characters or fewer');
  return title;
};

const cleanDescription = (value) => {
  const description = String(value ?? '').trim();
  if (description.length < 10) throw new ValidationException('Description must be at least 10 characters');
  if (description.length > 2000) throw new ValidationException('Description must be 2000 characters or fewer');
  return description;
};

const cleanDuration = (value) => {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds) || seconds < 15 || seconds > 14400) {
    throw new ValidationException('Duration must be between 15 seconds and 4 hours');
  }
  return seconds;
};

const cleanYoutube = (value) => {
  const id = extractYouTubeId(value);
  if (!id) {
    throw new ValidationException('Paste a valid YouTube link (watch, youtu.be, shorts or embed)');
  }
  return {
    youtubeId: id,
    thumbnailUrl: youtubeThumbnail(id),
    watchUrl: youtubeWatchUrl(id),
  };
};

const cleanPublishAt = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationException('Invalid publish date');
  return date;
};

const engagementFor = async (repo, partnerId) => {
  const videos = await repo.listPublishedForEngagement(104);
  const ids = videos.map((video) => String(video._id));
  const progress = ids.length > 0
    ? await repo.listProgressForPartner(partnerId, ids)
    : [];
  return computeEngagement({
    videos: videos.map((video) => ({
      id: String(video._id),
      weekStart: video.weekStart,
      publishedAt: video.publishedAt,
      createdAt: video.createdAt,
    })),
    progress,
    percentRequired: completionPercent(),
  });
};

const withAuthor = (comment, authors) => ({
  ...comment,
  author: authors[String(comment.partnerId)] ?? null,
});

export class CreateWeeklyVideoUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ adminId, input = {} }) {
    const weekStart = normalizeWeekStart(input.weekStart);
    const duplicate = await this.repo.findByWeek(weekStart);
    if (duplicate) throw new ConflictException(`A video already exists for the week of ${weekStart}`);
    const youtube = cleanYoutube(input.youtubeUrl);
    const title = cleanTitle(input.title);
    const description = cleanDescription(input.description);
    const durationSeconds = cleanDuration(input.durationSeconds);
    return this.repo.create({
      weekStart,
      weekEnd: weekEndFor(weekStart),
      title,
      description,
      youtubeId: youtube.youtubeId,
      youtubeUrl: youtube.watchUrl,
      thumbnailUrl: youtube.thumbnailUrl,
      durationSeconds,
      status: 'draft',
      createdBy: adminId ?? null,
      updatedBy: adminId ?? null,
    });
  }
}

export class UpdateWeeklyVideoUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ id, adminId, patch = {} }) {
    const existing = await this.repo.findRawById(id);
    if (!existing) throw new NotFoundException('Weekly video not found');
    if (existing.status === 'archived') throw new ValidationException('Archived videos cannot be edited');

    const next = {};
    if (patch.weekStart !== undefined) {
      const weekStart = normalizeWeekStart(patch.weekStart);
      if (existing.status === 'published' && weekStart !== existing.weekStart) {
        throw new ValidationException('Week cannot change after the video is published');
      }
      const duplicate = await this.repo.findByWeek(weekStart, { excludeId: id });
      if (duplicate) throw new ConflictException(`A video already exists for the week of ${weekStart}`);
      next.weekStart = weekStart;
      next.weekEnd = weekEndFor(weekStart);
    }
    if (patch.youtubeUrl !== undefined) {
      const youtube = cleanYoutube(patch.youtubeUrl);
      if (existing.status === 'published' && youtube.youtubeId !== existing.youtubeId) {
        throw new ValidationException('Video link cannot change after the video is published');
      }
      next.youtubeId = youtube.youtubeId;
      next.youtubeUrl = youtube.watchUrl;
      next.thumbnailUrl = youtube.thumbnailUrl;
    }
    if (patch.durationSeconds !== undefined) {
      const durationSeconds = cleanDuration(patch.durationSeconds);
      if (existing.status === 'published' && durationSeconds !== Number(existing.durationSeconds)) {
        throw new ValidationException('Duration cannot change after the video is published');
      }
      next.durationSeconds = durationSeconds;
    }
    if (patch.title !== undefined) next.title = cleanTitle(patch.title);
    if (patch.description !== undefined) next.description = cleanDescription(patch.description);
    if (Object.keys(next).length === 0) throw new ValidationException('Nothing to update');
    next.updatedBy = adminId ?? null;
    return this.repo.updateById(id, next);
  }
}

export class PublishWeeklyVideoUseCase {
  constructor({ repo, notifier }) {
    Object.assign(this, { repo, notifier });
  }

  async execute({ id, adminId, publishAt = null }) {
    const existing = await this.repo.findRawById(id);
    if (!existing) throw new NotFoundException('Weekly video not found');
    if (existing.status === 'archived') throw new ValidationException('Archived videos cannot be published');
    if (existing.status === 'published') {
      return {
        video: shapeWeeklyVideo(existing, { admin: true }),
        scheduled: false,
        repeated: true,
        notification: null,
      };
    }

    const target = cleanPublishAt(publishAt) ?? new Date();
    const now = new Date();
    if (target.getTime() > now.getTime() + 1000) {
      const scheduled = await this.repo.markScheduled(id, target, adminId ?? null);
      if (!scheduled) {
        const current = await this.repo.findById(id);
        return { video: current, scheduled: current?.status === 'scheduled', repeated: true, notification: null };
      }
      return { video: scheduled, scheduled: true, repeated: false, notification: null };
    }

    const claimed = await this.repo.claimPublish(id, now);
    if (!claimed) {
      const current = await this.repo.findById(id);
      return { video: current, scheduled: false, repeated: true, notification: null };
    }
    let report;
    try {
      report = await this.notifier.notify(claimed);
    } catch (error) {
      report = { delivered: 0, failed: 1, capped: false, total: 0, error: error?.message ?? 'Notification failed' };
    }
    const video = await this.repo.setNotificationResult(id, {
      notifiedAt: report.delivered > 0 ? new Date() : null,
      count: report.delivered,
      failed: report.failed,
      capped: report.capped,
    });
    return { video, scheduled: false, repeated: false, notification: report };
  }
}

export class RetryWeeklyVideoNotificationsUseCase {
  constructor({ repo, notifier }) {
    Object.assign(this, { repo, notifier });
  }

  async execute({ id }) {
    const existing = await this.repo.findRawById(id);
    if (!existing) throw new NotFoundException('Weekly video not found');
    if (existing.status !== 'published') throw new ValidationException('Publish the video before notifying members');
    let report;
    try {
      report = await this.notifier.notify(shapeWeeklyVideo(existing, { admin: true }));
    } catch (error) {
      report = { delivered: 0, failed: 1, capped: false, total: 0, error: error?.message ?? 'Notification failed' };
    }
    const video = await this.repo.setNotificationResult(id, {
      notifiedAt: report.delivered > 0 ? new Date() : null,
      count: report.delivered,
      failed: report.failed,
      capped: report.capped,
    });
    return { video, notification: report };
  }
}

export class ArchiveWeeklyVideoUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ id, adminId }) {
    const existing = await this.repo.findRawById(id);
    if (!existing) throw new NotFoundException('Weekly video not found');
    if (existing.status === 'archived') return shapeWeeklyVideo(existing, { admin: true });
    return this.repo.markArchived(id, adminId ?? null);
  }
}

export class ListAdminWeeklyVideosUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  execute(query = {}) {
    return this.repo.listAdmin(query);
  }
}

export class GetAdminWeeklyVideoStatsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ id }) {
    const video = await this.repo.findById(id);
    if (!video) throw new NotFoundException('Weekly video not found');
    const [stats, progressData, commentsData] = await Promise.all([
      this.repo.statsForVideo(id),
      this.repo.listProgressForVideo(id, { limit: 100 }),
      this.repo.listComments(id, { limit: 50, includeHidden: true }),
    ]);
    const participantIds = progressData.rows.map((row) => String(row.partnerId));
    const commentIds = commentsData.rows.map((row) => String(row.partnerId));
    const authors = await this.repo.authorLabels([...participantIds, ...commentIds]);
    const participants = progressData.rows.map((row) => ({
      ...shapeProgress(row),
      author: authors[String(row.partnerId)] ?? null,
    }));
    const comments = commentsData.rows.map((row) => ({
      ...row,
      author: authors[String(row.partnerId)] ?? null,
    }));
    return {
      video,
      stats: {
        ...stats,
        completionRate: stats.started > 0
          ? Math.round((stats.completed / stats.started) * 1000) / 10
          : 0,
      },
      participants,
      comments: { items: comments, total: commentsData.total },
    };
  }
}

export class ListAdminWeeklyVideoCommentsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ id, limit = 100, skip = 0 }) {
    const video = await this.repo.findById(id);
    if (!video) throw new NotFoundException('Weekly video not found');
    const data = await this.repo.listComments(id, { limit, skip, includeHidden: true });
    const authors = await this.repo.authorLabels(data.rows.map((row) => String(row.partnerId)));
    return {
      items: data.rows.map((row) => ({
        ...row,
        author: authors[String(row.partnerId)] ?? null,
      })),
      total: data.total,
    };
  }
}

export class ModerateWeeklyVideoCommentUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ commentId, status, adminId }) {
    if (!['visible', 'hidden'].includes(status)) throw new ValidationException('Invalid comment status');
    const existing = await this.repo.findCommentById(commentId);
    if (!existing) throw new NotFoundException('Reflection not found');
    return this.repo.setCommentStatus(commentId, status, adminId ?? null);
  }
}

export class CurrentWeeklyVideoUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ partnerId }) {
    const video = await this.repo.currentPublished();
    const engagement = await engagementFor(this.repo, partnerId);
    if (!video) {
      return {
        video: null,
        progress: null,
        reflection: null,
        commentCount: 0,
        commentsUnlocked: false,
        engagement,
      };
    }
    const [progress, reflection, commentCount] = await Promise.all([
      this.repo.getProgress(video.id, partnerId),
      this.repo.getComment(video.id, partnerId),
      this.repo.countComments(video.id, { visibleOnly: true }),
    ]);
    return {
      video,
      progress,
      reflection,
      commentCount,
      commentsUnlocked: Boolean(progress?.completed),
      engagement,
    };
  }
}

export class ListWeeklyVideosUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ partnerId, limit = 50 }) {
    const videos = await this.repo.listPublished(limit);
    const ids = videos.map((video) => video.id);
    const progressRows = ids.length > 0
      ? await this.repo.listProgressForPartner(partnerId, ids)
      : [];
    const progressByVideo = new Map(progressRows.map((row) => [String(row.videoId), row]));
    return {
      items: videos.map((video) => {
        const progress = shapeProgress(progressByVideo.get(video.id));
        return {
          ...video,
          progress,
          reflected: Boolean(progressByVideo.get(video.id)?.reflectionAt),
        };
      }),
      engagement: await engagementFor(this.repo, partnerId),
    };
  }
}

export class GetWeeklyVideoUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ partnerId, id }) {
    const video = await this.repo.findPublishedById(id);
    if (!video) throw new NotFoundException('Weekly video not found');
    const [progress, reflection, commentCount, engagement] = await Promise.all([
      this.repo.getProgress(id, partnerId),
      this.repo.getComment(id, partnerId),
      this.repo.countComments(id, { visibleOnly: true }),
      engagementFor(this.repo, partnerId),
    ]);
    return {
      video,
      progress,
      reflection,
      commentCount,
      commentsUnlocked: Boolean(progress?.completed),
      engagement,
    };
  }
}

export class StartWeeklyVideoWatchUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ partnerId, id }) {
    const video = await this.repo.findPublishedById(id);
    if (!video) throw new NotFoundException('Weekly video not found');
    if (!(Number(video.durationSeconds) > 0)) {
      throw new ValidationException('This video has no duration configured yet');
    }
    const sessionId = randomUUID();
    const progress = await this.repo.startProgress({
      videoId: id,
      partnerId,
      sessionId,
      durationSeconds: Number(video.durationSeconds),
    });
    return { video, progress, sessionId };
  }
}

export class RecordWeeklyVideoHeartbeatUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({
    partnerId,
    id,
    sessionId,
    positionSeconds,
    playing,
    visible,
  }) {
    const video = await this.repo.findPublishedById(id);
    if (!video) throw new NotFoundException('Weekly video not found');
    if (!(Number(video.durationSeconds) > 0)) {
      throw new ValidationException('This video has no duration configured yet');
    }
    const progress = await this.repo.getRawProgress(id, partnerId);
    if (!progress) throw new ValidationException('Start the video before sending watch progress');
    if (progress.sessionId && sessionId && String(progress.sessionId) !== String(sessionId)) {
      throw new ConflictException('This watch session has expired. Reload the video and continue.');
    }
    const position = Number(positionSeconds);
    if (!Number.isFinite(position) || position < 0) {
      throw new ValidationException('Invalid playback position');
    }
    const now = new Date();
    const last = progress.lastHeartbeatAt ? new Date(progress.lastHeartbeatAt) : null;
    if (last && now.getTime() - last.getTime() < MIN_HEARTBEAT_GAP_MS) {
      return shapeProgress(progress);
    }
    const result = applyHeartbeat({
      watchedSeconds: Number(progress.watchedSeconds) || 0,
      lastPositionSeconds: Number(progress.lastPositionSeconds) || 0,
      durationSeconds: Number(video.durationSeconds),
      lastHeartbeatAt: last,
      now,
      positionSeconds: position,
      playing: playing === true,
      visible: visible !== false,
      percentRequired: completionPercent(),
    });
    const updated = await this.repo.updateProgress(id, partnerId, {
      sessionId: sessionId || progress.sessionId || null,
      watchedSeconds: result.watchedSeconds,
      lastPositionSeconds: result.lastPositionSeconds,
      durationSeconds: Number(video.durationSeconds),
      percent: result.percent,
      lastHeartbeatAt: now,
      completedAt: progress.completedAt ?? (result.completed ? now : null),
    }, { incrementHeartbeat: true });
    return updated;
  }
}

export class ListWeeklyVideoCommentsUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ partnerId, id, limit = 50, skip = 0 }) {
    const video = await this.repo.findPublishedById(id);
    if (!video) throw new NotFoundException('Weekly video not found');
    const progress = await this.repo.getProgress(id, partnerId);
    const count = await this.repo.countComments(id, { visibleOnly: true });
    if (!progress?.completed) {
      return {
        unlocked: false,
        count,
        total: count,
        items: [],
        message: `Watch at least ${completionPercent()}% to unlock the reflections.`,
      };
    }
    const data = await this.repo.listComments(id, { limit, skip, includeHidden: false });
    const authors = await this.repo.authorLabels(data.rows.map((row) => String(row.partnerId)));
    return {
      unlocked: true,
      count,
      total: data.total,
      items: data.rows.map((row) => withAuthor(row, authors)),
    };
  }
}

export class SubmitWeeklyVideoReflectionUseCase {
  constructor({ repo }) {
    this.repo = repo;
  }

  async execute({ partnerId, id, body }) {
    const video = await this.repo.findPublishedById(id);
    if (!video) throw new NotFoundException('Weekly video not found');
    const progress = await this.repo.getRawProgress(id, partnerId);
    if (!progress?.completedAt) {
      throw new ForbiddenException(`Watch at least ${completionPercent()}% before sharing your reflection`);
    }
    const cleanBody = normalizeCommentBody(body);
    const now = new Date();
    const comment = await this.repo.upsertComment({
      videoId: id,
      partnerId,
      body: cleanBody,
      now,
    });
    if (!progress.reflectionAt) {
      await this.repo.updateProgress(id, partnerId, { reflectionAt: now });
    }
    const authors = await this.repo.authorLabels([String(partnerId)]);
    return {
      comment: {
        ...comment,
        author: authors[String(partnerId)] ?? null,
      },
      engagement: await engagementFor(this.repo, partnerId),
    };
  }
}

export { engagementFor };
