import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { recordAudit } from '../../audit/index.js';
import { NotifyUseCase } from '../../notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { MongoWeeklyVideoRepository } from '../infrastructure/WeeklyVideo.mongo.repository.js';
import { WeeklyVideoNotifier } from '../application/WeeklyVideo.notifier.js';
import {
  ArchiveWeeklyVideoUseCase,
  CreateWeeklyVideoUseCase,
  CurrentWeeklyVideoUseCase,
  GetAdminWeeklyVideoStatsUseCase,
  GetWeeklyVideoUseCase,
  ListAdminWeeklyVideoCommentsUseCase,
  ListAdminWeeklyVideosUseCase,
  ListWeeklyVideoCommentsUseCase,
  ListWeeklyVideosUseCase,
  ModerateWeeklyVideoCommentUseCase,
  PublishWeeklyVideoUseCase,
  RecordWeeklyVideoHeartbeatUseCase,
  RetryWeeklyVideoNotificationsUseCase,
  StartWeeklyVideoWatchUseCase,
  SubmitWeeklyVideoReflectionUseCase,
  UpdateWeeklyVideoUseCase,
} from '../application/WeeklyVideo.usecases.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const IdParam = z.object({ id: objectId });
const CommentIdParam = z.object({ commentId: objectId });
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  skip: z.coerce.number().int().min(0).optional().default(0),
});
const CreateSchema = z.object({
  youtubeUrl: z.string().trim().min(5).max(300),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  weekStart: z.string().trim().min(10).max(40),
  durationSeconds: z.coerce.number().int().min(15).max(14400),
});
const UpdateSchema = z.object({
  youtubeUrl: z.string().trim().min(5).max(300).optional(),
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(10).max(2000).optional(),
  weekStart: z.string().trim().min(10).max(40).optional(),
  durationSeconds: z.coerce.number().int().min(15).max(14400).optional(),
}).refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
const PublishSchema = z.object({
  publishAt: z.string().trim().min(10).max(40).optional(),
});
const HeartbeatSchema = z.object({
  sessionId: z.string().trim().min(10).max(80),
  positionSeconds: z.coerce.number().min(0).max(14400),
  playing: z.boolean().optional().default(false),
  visible: z.boolean().optional().default(true),
});
const CommentSchema = z.object({
  body: z.string().trim().min(20).max(1000),
});
const ModerateSchema = z.object({
  status: z.enum(['visible', 'hidden']),
});

const makeNotifier = (repo, deps = {}) => deps.notifier ?? new WeeklyVideoNotifier({
  repo,
  notify: deps.notify ?? new NotifyUseCase({
    stored: deps.stored ?? new MongoStoredNotificationStore(),
  }),
});

/** Member-facing weekly video, watch verification and reflections. */
export const buildWeeklyVideoRouter = (deps = {}) => {
  const repo = deps.repo ?? new MongoWeeklyVideoRepository();
  const current = new CurrentWeeklyVideoUseCase({ repo });
  const list = new ListWeeklyVideosUseCase({ repo });
  const detail = new GetWeeklyVideoUseCase({ repo });
  const start = new StartWeeklyVideoWatchUseCase({ repo });
  const heartbeat = new RecordWeeklyVideoHeartbeatUseCase({ repo });
  const comments = new ListWeeklyVideoCommentsUseCase({ repo });
  const reflect = new SubmitWeeklyVideoReflectionUseCase({ repo });

  const router = express.Router();
  router.use(deps.auth ?? requireAuth);

  router.get('/current', asyncHandler(async (req, res) => {
    const data = await current.execute({ partnerId: req.auth?.partnerId });
    return sendSuccess(res, { message: 'Weekly video retrieved successfully', data });
  }));

  router.get('/', validate({ query: ListQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await list.execute({ partnerId: req.auth?.partnerId, limit: q.limit });
    return sendSuccess(res, { message: 'Weekly videos retrieved successfully', data });
  }));

  router.get('/:id/comments', validate({ params: IdParam, query: ListQuery }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const q = req.validated?.query ?? req.query;
    const data = await comments.execute({
      partnerId: req.auth?.partnerId,
      id: params.id,
      limit: q.limit,
      skip: q.skip,
    });
    return sendSuccess(res, { message: data.unlocked ? 'Reflections retrieved' : 'Reflections are locked', data });
  }));

  router.post('/:id/comments', validate({ params: IdParam, body: CommentSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await reflect.execute({
      partnerId: req.auth?.partnerId,
      id: params.id,
      body: body.body,
    });
    return sendSuccess(res, { message: 'Reflection saved', data });
  }));

  router.post('/:id/watch/start', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await start.execute({ partnerId: req.auth?.partnerId, id: params.id });
    return sendSuccess(res, { message: 'Watch session started', data });
  }));

  router.post('/:id/watch/heartbeat', validate({ params: IdParam, body: HeartbeatSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await heartbeat.execute({
      partnerId: req.auth?.partnerId,
      id: params.id,
      sessionId: body.sessionId,
      positionSeconds: body.positionSeconds,
      playing: body.playing,
      visible: body.visible,
    });
    return sendSuccess(res, { message: 'Watch progress recorded', data });
  }));

  router.get('/:id', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await detail.execute({ partnerId: req.auth?.partnerId, id: params.id });
    return sendSuccess(res, { message: 'Weekly video retrieved successfully', data });
  }));

  return router;
};

/** Admin desk: create, schedule, publish, stats and reflection moderation. */
export const buildAdminWeeklyVideoRouter = (deps = {}) => {
  const repo = deps.repo ?? new MongoWeeklyVideoRepository();
  const notifier = makeNotifier(repo, deps);
  const list = new ListAdminWeeklyVideosUseCase({ repo });
  const create = new CreateWeeklyVideoUseCase({ repo });
  const update = new UpdateWeeklyVideoUseCase({ repo });
  const publish = new PublishWeeklyVideoUseCase({ repo, notifier });
  const archive = new ArchiveWeeklyVideoUseCase({ repo });
  const retry = new RetryWeeklyVideoNotificationsUseCase({ repo, notifier });
  const stats = new GetAdminWeeklyVideoStatsUseCase({ repo });
  const comments = new ListAdminWeeklyVideoCommentsUseCase({ repo });
  const moderate = new ModerateWeeklyVideoCommentUseCase({ repo });
  const audit = deps.audit ?? recordAudit;

  const router = express.Router();
  router.use(deps.auth ?? requireAuth, deps.admin ?? requireRole('admin'));

  router.get('/', validate({ query: ListQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await list.execute({ limit: q.limit, skip: q.skip });
    return sendSuccess(res, { message: 'Weekly videos retrieved successfully', data });
  }));

  router.post('/', validate({ body: CreateSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await create.execute({ adminId: req.auth?.partnerId, input: body });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'weekly_video.create',
      targetType: 'weekly_video',
      targetId: data.id,
      detail: { weekStart: data.weekStart, title: data.title },
    });
    return sendSuccess(res, { message: 'Weekly video draft created', data, statusCode: 201 });
  }));

  router.patch('/comments/:commentId', validate({ params: CommentIdParam, body: ModerateSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await moderate.execute({
      commentId: params.commentId,
      status: body.status,
      adminId: req.auth?.partnerId,
    });
    void audit({
      actorId: req.auth?.partnerId,
      action: body.status === 'hidden' ? 'weekly_video.comment.hide' : 'weekly_video.comment.show',
      targetType: 'weekly_video_comment',
      targetId: params.commentId,
      detail: { videoId: data.videoId },
    });
    return sendSuccess(res, { message: body.status === 'hidden' ? 'Reflection hidden' : 'Reflection restored', data });
  }));

  router.patch('/:id', validate({ params: IdParam, body: UpdateSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await update.execute({ id: params.id, adminId: req.auth?.partnerId, patch: body });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'weekly_video.update',
      targetType: 'weekly_video',
      targetId: params.id,
      detail: { fields: Object.keys(body) },
    });
    return sendSuccess(res, { message: 'Weekly video updated', data });
  }));

  router.post('/:id/publish', validate({ params: IdParam, body: PublishSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await publish.execute({
      id: params.id,
      adminId: req.auth?.partnerId,
      publishAt: body.publishAt,
    });
    void audit({
      actorId: req.auth?.partnerId,
      action: data.scheduled ? 'weekly_video.schedule' : 'weekly_video.publish',
      targetType: 'weekly_video',
      targetId: params.id,
      detail: {
        scheduled: data.scheduled,
        notified: data.notification?.delivered ?? 0,
        failed: data.notification?.failed ?? 0,
      },
    });
    return sendSuccess(res, {
      message: data.scheduled ? 'Weekly video scheduled' : 'Weekly video published',
      data,
    });
  }));

  router.post('/:id/archive', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await archive.execute({ id: params.id, adminId: req.auth?.partnerId });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'weekly_video.archive',
      targetType: 'weekly_video',
      targetId: params.id,
    });
    return sendSuccess(res, { message: 'Weekly video archived', data });
  }));

  router.post('/:id/notify', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await retry.execute({ id: params.id });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'weekly_video.notify',
      targetType: 'weekly_video',
      targetId: params.id,
      detail: { delivered: data.notification?.delivered ?? 0, failed: data.notification?.failed ?? 0 },
    });
    return sendSuccess(res, { message: 'Notifications sent', data });
  }));

  router.get('/:id/stats', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await stats.execute({ id: params.id });
    return sendSuccess(res, { message: 'Weekly video stats retrieved', data });
  }));

  router.get('/:id/comments', validate({ params: IdParam, query: ListQuery }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const q = req.validated?.query ?? req.query;
    const data = await comments.execute({ id: params.id, limit: q.limit, skip: q.skip });
    return sendSuccess(res, { message: 'Reflections retrieved', data });
  }));

  return router;
};

export default buildWeeklyVideoRouter();
