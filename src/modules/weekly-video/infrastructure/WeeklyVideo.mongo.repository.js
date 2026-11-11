import mongoose from 'mongoose';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { weekEndFor, weekLabel } from '../domain/WeeklyVideo.domain.js';
import {
  WeeklyVideoCommentModel,
  WeeklyVideoModel,
  WeeklyVideoProgressModel,
} from './WeeklyVideo.models.js';

const oid = (value) => String(value ?? '');
const iso = (value) => (value ? new Date(value).toISOString() : null);

export const shapeWeeklyVideo = (row, { admin = false } = {}) => {
  if (!row) return null;
  const base = {
    id: oid(row._id ?? row.id),
    weekStart: row.weekStart,
    weekEnd: row.weekEnd ?? weekEndFor(row.weekStart),
    weekLabel: weekLabel(row.weekStart),
    title: row.title,
    description: row.description ?? '',
    youtubeId: row.youtubeId,
    thumbnailUrl: row.thumbnailUrl ?? '',
    durationSeconds: Number(row.durationSeconds) || 0,
    status: row.status,
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
  if (!admin) return base;
  return {
    ...base,
    youtubeUrl: row.youtubeUrl ?? '',
    publishAt: iso(row.publishAt),
    notifiedAt: iso(row.notifiedAt),
    notificationCount: Number(row.notificationCount) || 0,
    notificationFailed: Number(row.notificationFailed) || 0,
    notificationCapped: row.notificationCapped === true,
    createdBy: row.createdBy ? oid(row.createdBy) : null,
    updatedBy: row.updatedBy ? oid(row.updatedBy) : null,
    archivedAt: iso(row.archivedAt),
  };
};

export const shapeProgress = (row) => {
  if (!row) return null;
  return {
    id: oid(row._id ?? row.id),
    videoId: oid(row.videoId),
    partnerId: oid(row.partnerId),
    watchedSeconds: Number(row.watchedSeconds) || 0,
    lastPositionSeconds: Number(row.lastPositionSeconds) || 0,
    durationSeconds: Number(row.durationSeconds) || 0,
    percent: Math.round((Number(row.percent) || 0) * 100) / 100,
    completed: Boolean(row.completedAt),
    completedAt: iso(row.completedAt),
    reflectionAt: iso(row.reflectionAt),
    startedAt: iso(row.startedAt),
    lastHeartbeatAt: iso(row.lastHeartbeatAt),
    heartbeatCount: Number(row.heartbeatCount) || 0,
  };
};

export const shapeComment = (row) => {
  if (!row) return null;
  return {
    id: oid(row._id ?? row.id),
    videoId: oid(row.videoId),
    partnerId: oid(row.partnerId),
    body: row.body,
    status: row.status,
    editedAt: iso(row.editedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
};

export class MongoWeeklyVideoRepository {
  async create(data) {
    const doc = await WeeklyVideoModel.create(data);
    return shapeWeeklyVideo(doc.toObject?.() ?? doc, { admin: true });
  }

  async findById(id) {
    return shapeWeeklyVideo(await WeeklyVideoModel.findById(id).lean(), { admin: true });
  }

  async findRawById(id) {
    return WeeklyVideoModel.findById(id).lean();
  }

  async findPublishedById(id) {
    return shapeWeeklyVideo(
      await WeeklyVideoModel.findOne({ _id: id, status: 'published' }).lean(),
    );
  }

  async findByWeek(weekStart, { excludeId = null } = {}) {
    const filter = { weekStart, status: { $ne: 'archived' } };
    if (excludeId) filter._id = { $ne: excludeId };
    return shapeWeeklyVideo(await WeeklyVideoModel.findOne(filter).lean(), { admin: true });
  }

  async currentPublished() {
    return shapeWeeklyVideo(
      await WeeklyVideoModel.findOne({ status: 'published' })
        .sort({ weekStart: -1, publishedAt: -1 })
        .lean(),
    );
  }

  async listPublished(limit = 50) {
    const rows = await WeeklyVideoModel.find({ status: 'published' })
      .sort({ weekStart: -1, publishedAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))
      .lean();
    return rows.map((row) => shapeWeeklyVideo(row));
  }

  async listPublishedForEngagement(limit = 104) {
    return WeeklyVideoModel.find({ status: 'published' })
      .sort({ weekStart: -1, publishedAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 104, 1), 260))
      .select('_id weekStart weekEnd publishedAt createdAt')
      .lean();
  }

  async listAdmin({ limit = 100, skip = 0 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const offset = Math.max(Number(skip) || 0, 0);
    const [rows, total] = await Promise.all([
      WeeklyVideoModel.find({}).sort({ weekStart: -1, createdAt: -1 }).skip(offset).limit(size).lean(),
      WeeklyVideoModel.countDocuments({}),
    ]);
    return { items: rows.map((row) => shapeWeeklyVideo(row, { admin: true })), total };
  }

  async updateById(id, patch) {
    const row = await WeeklyVideoModel.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    return shapeWeeklyVideo(row, { admin: true });
  }

  async markScheduled(id, publishAt, updatedBy = null) {
    const row = await WeeklyVideoModel.findOneAndUpdate(
      { _id: id, status: { $in: ['draft', 'scheduled'] } },
      { $set: { status: 'scheduled', publishAt, updatedBy } },
      { new: true },
    ).lean();
    return shapeWeeklyVideo(row, { admin: true });
  }

  async claimPublish(id, now = new Date()) {
    const row = await WeeklyVideoModel.findOneAndUpdate(
      { _id: id, status: { $in: ['draft', 'scheduled'] } },
      { $set: { status: 'published', publishedAt: now } },
      { new: true },
    ).lean();
    return shapeWeeklyVideo(row, { admin: true });
  }

  async markArchived(id, adminId = null, now = new Date()) {
    return shapeWeeklyVideo(
      await WeeklyVideoModel.findByIdAndUpdate(
        id,
        { $set: { status: 'archived', archivedAt: now, archivedBy: adminId } },
        { new: true },
      ).lean(),
      { admin: true },
    );
  }

  async setNotificationResult(id, { notifiedAt = new Date(), count = 0, failed = 0, capped = false } = {}) {
    return shapeWeeklyVideo(
      await WeeklyVideoModel.findByIdAndUpdate(
        id,
        {
          $set: {
            notifiedAt,
            notificationCount: Math.max(Number(count) || 0, 0),
            notificationFailed: Math.max(Number(failed) || 0, 0),
            notificationCapped: capped === true,
          },
        },
        { new: true },
      ).lean(),
      { admin: true },
    );
  }

  async listScheduledDue(now = new Date(), limit = 10) {
    return WeeklyVideoModel.find({
      status: 'scheduled',
      publishAt: { $ne: null, $lte: now },
    })
      .sort({ publishAt: 1 })
      .limit(Math.min(Math.max(Number(limit) || 10, 1), 50))
      .lean();
  }

  async getProgress(videoId, partnerId) {
    return shapeProgress(
      await WeeklyVideoProgressModel.findOne({ videoId, partnerId }).lean(),
    );
  }

  async getRawProgress(videoId, partnerId) {
    return WeeklyVideoProgressModel.findOne({ videoId, partnerId }).lean();
  }

  async startProgress({ videoId, partnerId, sessionId, durationSeconds, now = new Date() }) {
    const row = await WeeklyVideoProgressModel.findOneAndUpdate(
      { videoId, partnerId },
      {
        $set: {
          sessionId,
          durationSeconds,
          lastHeartbeatAt: now,
        },
        $setOnInsert: {
          watchedSeconds: 0,
          lastPositionSeconds: 0,
          percent: 0,
          startedAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return shapeProgress(row);
  }

  async updateProgress(videoId, partnerId, patch, { incrementHeartbeat = false } = {}) {
    const update = { $set: patch };
    if (incrementHeartbeat) update.$inc = { heartbeatCount: 1 };
    const row = await WeeklyVideoProgressModel.findOneAndUpdate(
      { videoId, partnerId },
      update,
      { new: true },
    ).lean();
    return shapeProgress(row);
  }

  async listProgressForPartner(partnerId, videoIds = []) {
    const filter = { partnerId };
    if (Array.isArray(videoIds) && videoIds.length > 0) filter.videoId = { $in: videoIds };
    return WeeklyVideoProgressModel.find(filter).lean();
  }

  async listProgressForVideo(videoId, { limit = 100, skip = 0 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const offset = Math.max(Number(skip) || 0, 0);
    const [rows, total, completed] = await Promise.all([
      WeeklyVideoProgressModel.find({ videoId }).sort({ updatedAt: -1 }).skip(offset).limit(size).lean(),
      WeeklyVideoProgressModel.countDocuments({ videoId }),
      WeeklyVideoProgressModel.countDocuments({ videoId, completedAt: { $ne: null } }),
    ]);
    return { rows, total, completed };
  }

  async countProgressForVideo(videoId, { completedOnly = false } = {}) {
    const filter = { videoId };
    if (completedOnly) filter.completedAt = { $ne: null };
    return WeeklyVideoProgressModel.countDocuments(filter);
  }

  async getComment(videoId, partnerId) {
    return shapeComment(
      await WeeklyVideoCommentModel.findOne({ videoId, partnerId }).lean(),
    );
  }

  async upsertComment({ videoId, partnerId, body, now = new Date() }) {
    const row = await WeeklyVideoCommentModel.findOneAndUpdate(
      { videoId, partnerId },
      {
        $set: { body, editedAt: now },
        $setOnInsert: { status: 'visible' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return shapeComment(row);
  }

  async listComments(videoId, { limit = 50, skip = 0, includeHidden = false } = {}) {
    const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const offset = Math.max(Number(skip) || 0, 0);
    const filter = { videoId };
    if (!includeHidden) filter.status = 'visible';
    const [rows, total] = await Promise.all([
      WeeklyVideoCommentModel.find(filter).sort({ createdAt: -1 }).skip(offset).limit(size).lean(),
      WeeklyVideoCommentModel.countDocuments(filter),
    ]);
    return { rows: rows.map(shapeComment), total };
  }

  async countComments(videoId, { visibleOnly = true } = {}) {
    const filter = { videoId };
    if (visibleOnly) filter.status = 'visible';
    return WeeklyVideoCommentModel.countDocuments(filter);
  }

  async findCommentById(id) {
    return shapeComment(await WeeklyVideoCommentModel.findById(id).lean());
  }

  async setCommentStatus(id, status, adminId = null, now = new Date()) {
    return shapeComment(
      await WeeklyVideoCommentModel.findByIdAndUpdate(
        id,
        {
          $set: {
            status,
            hiddenBy: status === 'hidden' ? adminId : null,
            hiddenAt: status === 'hidden' ? now : null,
          },
        },
        { new: true },
      ).lean(),
    );
  }

  async authorLabels(ids = []) {
    const unique = [...new Set(ids.map(String))].filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (unique.length === 0) return {};
    const rows = await PartnersModel.find({ _id: { $in: unique } })
      .select('username name surname profileImage commissionRank')
      .lean();
    return Object.fromEntries(rows.map((row) => [String(row._id), {
      id: String(row._id),
      username: row.username ?? '',
      name: [row.name, row.surname].filter(Boolean).join(' ') || row.username || 'Member',
      profileImage: row.profileImage ?? null,
      commissionRank: row.commissionRank ?? 'Partner',
    }]));
  }

  async notificationRecipients(cap = 5000) {
    const limit = Math.min(Math.max(Number(cap) || 5000, 1), 20000);
    const rows = await PartnersModel.find({
      $or: [
        { suspendedAt: null },
        { suspendedAt: { $exists: false } },
      ],
    })
      .select('_id')
      .sort({ _id: 1 })
      .limit(limit + 1)
      .lean();
    return {
      ids: rows.slice(0, limit).map((row) => String(row._id)),
      capped: rows.length > limit,
    };
  }

  async statsForVideo(videoId) {
    const [started, completed, comments, visibleComments] = await Promise.all([
      WeeklyVideoProgressModel.countDocuments({ videoId }),
      WeeklyVideoProgressModel.countDocuments({ videoId, completedAt: { $ne: null } }),
      WeeklyVideoCommentModel.countDocuments({ videoId }),
      WeeklyVideoCommentModel.countDocuments({ videoId, status: 'visible' }),
    ]);
    return { started, completed, comments, visibleComments };
  }
}
