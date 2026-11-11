import mongoose from 'mongoose';
import {
  WEEKLY_VIDEO_COMMENT_STATUSES,
  WEEKLY_VIDEO_STATUSES,
} from '../domain/WeeklyVideo.domain.js';

const weeklyVideoSchema = new mongoose.Schema(
  {
    weekStart: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    weekEnd: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    youtubeId: { type: String, required: true, trim: true, maxlength: 11, index: true },
    youtubeUrl: { type: String, default: '', trim: true, maxlength: 300 },
    thumbnailUrl: { type: String, default: '', trim: true, maxlength: 500 },
    durationSeconds: { type: Number, min: 0, max: 14400, default: 0 },
    status: {
      type: String,
      enum: WEEKLY_VIDEO_STATUSES,
      default: 'draft',
      index: true,
    },
    publishAt: { type: Date, default: null, index: true },
    publishedAt: { type: Date, default: null },
    notifiedAt: { type: Date, default: null },
    notificationCount: { type: Number, min: 0, default: 0 },
    notificationFailed: { type: Number, min: 0, default: 0 },
    notificationCapped: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  },
  { timestamps: true, collection: 'weekly_videos' },
);

weeklyVideoSchema.index({ status: 1, weekStart: -1 });
weeklyVideoSchema.index({ status: 1, publishAt: 1 });
weeklyVideoSchema.index({ weekStart: 1, status: 1 });

const weeklyVideoProgressSchema = new mongoose.Schema(
  {
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WeeklyVideo',
      required: true,
      index: true,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      required: true,
      index: true,
    },
    sessionId: { type: String, default: null, trim: true, maxlength: 80 },
    watchedSeconds: { type: Number, min: 0, default: 0 },
    lastPositionSeconds: { type: Number, min: 0, default: 0 },
    durationSeconds: { type: Number, min: 0, default: 0 },
    percent: { type: Number, min: 0, max: 100, default: 0 },
    startedAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    completedAt: { type: Date, default: null, index: true },
    reflectionAt: { type: Date, default: null },
    heartbeatCount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true, collection: 'weekly_video_progress' },
);

weeklyVideoProgressSchema.index({ videoId: 1, partnerId: 1 }, { unique: true });
weeklyVideoProgressSchema.index({ partnerId: 1, completedAt: -1 });

const weeklyVideoCommentSchema = new mongoose.Schema(
  {
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WeeklyVideo',
      required: true,
      index: true,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      required: true,
      index: true,
    },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: WEEKLY_VIDEO_COMMENT_STATUSES,
      default: 'visible',
      index: true,
    },
    editedAt: { type: Date, default: null },
    hiddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    hiddenAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'weekly_video_comments' },
);

weeklyVideoCommentSchema.index({ videoId: 1, partnerId: 1 }, { unique: true });
weeklyVideoCommentSchema.index({ videoId: 1, status: 1, createdAt: -1 });
weeklyVideoCommentSchema.index({ videoId: 1, status: 1, createdAt: -1, _id: -1 });

export const WeeklyVideoModel =
  mongoose.models.WeeklyVideo
  || mongoose.model('WeeklyVideo', weeklyVideoSchema);

export const WeeklyVideoProgressModel =
  mongoose.models.WeeklyVideoProgress
  || mongoose.model('WeeklyVideoProgress', weeklyVideoProgressSchema);

export const WeeklyVideoCommentModel =
  mongoose.models.WeeklyVideoComment
  || mongoose.model('WeeklyVideoComment', weeklyVideoCommentSchema);
