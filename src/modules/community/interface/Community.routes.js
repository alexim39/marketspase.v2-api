import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  AddCommentUseCase, CommunityAnalyticsUseCase, CreatePostUseCase, DeletePostUseCase, DirectoryUseCase, GetFeedUseCase,
  ListCommentsUseCase, PinPostUseCase, ReportPostUseCase, ToggleLikeUseCase, ToggleSaveUseCase, UpdatePostUseCase,
} from '../application/Community.usecases.js';
import { ListReportedUseCase, ModeratePostUseCase } from '../application/Community.moderation.usecase.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { recordAudit } from '../../audit/index.js';
import { MongoCommunityStore } from '../infrastructure/Community.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { env } from '../../../shared/config/env.js';
import { DomainEvents } from '../../../shared/events/DomainEvents.js';
import { sendEmail } from '../../../services/emailService.js';
import { FanoutMentionsUseCase } from '../../notifications/application/MentionFanout.usecase.js';
import { NotifyUseCase } from '../../notifications/application/NotificationsCenter.usecases.js';
import { NotificationDeliveryService } from '../../notifications/application/NotificationDelivery.js';
import { NOTIFICATION_EVENTS } from '../../notifications/domain/NotificationEvents.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { MentionMailer } from '../../notifications/infrastructure/MentionMailer.js';
import { buildSmsSender } from '../../notifications/infrastructure/SmsSender.js';
import { buildPushSender } from '../../notifications/infrastructure/PushSender.js';
import { ATTACHMENT_MIMES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, POST_KINDS, AUDIENCE_SCOPES } from '../domain/Post.entity.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';
import { communityUpload } from './Community.upload.js';
import { buildImageStore } from '../../settings/infrastructure/CloudinaryClient.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const AttachmentSchema = z.object({
  // Legacy local files (`/uploads/community/…`) plus Cloudinary https URLs.
  url: z.union([
    z.string().trim().regex(/^\/uploads\/community\/[A-Za-z0-9_.-]+$/, 'Invalid attachment url'),
    z.string().trim().regex(/^https:\/\/[^\s]+$/, 'Invalid attachment url'),
  ]),
  mime: z.enum(ATTACHMENT_MIMES),
  size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
});

const PostSchema = z.object({
  kind: z.enum(POST_KINDS),
  title: z.string().trim().max(120).optional().default(''),
  body: z.string().trim().min(1).max(2000),
  link: z.string().trim().max(500).optional().default(''),
  scope: z.enum(AUDIENCE_SCOPES),
  attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS).optional().default([]),
});

const CommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  parentId: objectId.optional(),
});

const FeedQuery = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const PinSchema = z.object({
  pinned: z.boolean(),
  pinnedUntil: z.coerce.date().optional(),
});
const PostEditSchema = z.object({
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  link: z.string().trim().max(500).optional(),
});
const ReportSchema = z.object({ reason: z.string().trim().max(300).optional().default('') });
const AnalyticsQuery = z.object({ days: z.coerce.number().int().min(1).max(90).optional().default(7) });

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildCommunityRouter = (deps = {}) => {
  const community = deps.community ?? new MongoCommunityStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const progress = deps.progress ?? new MongoProgressionStore();

  const stored = deps.stored ?? new MongoStoredNotificationStore();
  // Event-driven fan-out: community emits facts, the notification slice
  // subscribes. Fresh bus per build (explicit, no cross-router leakage);
  // pass deps.events to share one across routers in tests.
  const events = deps.events ?? new DomainEvents();
  const fanout = deps.fanout ?? new FanoutMentionsUseCase({
    community,
    stored,
    delivery: new NotificationDeliveryService({
      stored,
      notify: new NotifyUseCase({ stored }),
      mail: sendEmail,
      sms: buildSmsSender(env.sms),
      push: buildPushSender(env.push, env.appBaseUrl),
    }),
    mailer: new MentionMailer(),
  });
  events.on(NOTIFICATION_EVENTS.MENTION_CREATED, (payload) => fanout.execute(payload));

  const feed = new GetFeedUseCase({ community, network, progress });
  const create = new CreatePostUseCase({ community, events });
  const like = new ToggleLikeUseCase({ community, network, progress });
  const comments = new ListCommentsUseCase({ community, network, progress });
  const comment = new AddCommentUseCase({ community, network, progress, events });
  const save = new ToggleSaveUseCase({ community });
  const report = new ReportPostUseCase({ community });
  const pin = deps.pin ?? new PinPostUseCase({
    community,
    partners: deps.partners ?? new MongoPartnerRepository(),
  });
  const update = new UpdatePostUseCase({ community, events });
  // Community media lives on Cloudinary (profile-photo pattern) under its
  // own folder; unconfigured credentials surface as 503, same as profiles.
  // Wired into delete paths too so post media dies with the post.
  const images = deps.images ?? buildImageStore({ ...(env.cloudinary ?? {}), folder: 'diamond-projects/community', label: 'Media' });
  const remove = new DeletePostUseCase({ community, media: images });
  const directory = new DirectoryUseCase({ community });
  const analytics = new CommunityAnalyticsUseCase({ community });
  const reported = deps.reported ?? new ListReportedUseCase({ community });
  const moderate = deps.moderate ?? new ModeratePostUseCase({ community, media: images });

  const router = express.Router();
  router.use(requireAuth);

  router.get('/feed', validate({ query: FeedQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await feed.execute({ viewerId: req.auth?.partnerId, before: q?.before, limit: q?.limit });
    res.status(200).json({ message: 'Feed retrieved successfully', data, success: true });
  }));

  router.post('/', validate({ body: PostSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await create.execute({ authorId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: 'Post created successfully', data, success: true });
  }));

  // Media upload (multipart `media` field) — streams the buffer to
  // Cloudinary and returns its URL to attach on POST /. Images upload as
  // image assets, videos as video assets. Legacy local files keep serving;
  // only new uploads go to the cloud.
  router.post('/attachments', communityUpload.single('media'), asyncHandler(async (req, res) => {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'No media uploaded', success: false, code: 'VALIDATION_ERROR' });
    }
    const original = String(req.file.originalname ?? '').toLowerCase();
    const ext = original.match(/\.(jpe?g|png|webp|gif|mp4|webm|mov)$/)?.[1] ?? '';
    const mime = String(req.file.mimetype ?? '').trim()
      || (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'png' ? 'image/png'
          : ext === 'webp' ? 'image/webp'
            : ext === 'gif' ? 'image/gif'
              : ext === 'mp4' ? 'video/mp4'
                : ext === 'webm' ? 'video/webm'
                  : ext === 'mov' ? 'video/quicktime' : '');
    if (!ATTACHMENT_MIMES.includes(mime)) {
      return res.status(400).json({ message: 'Only images and videos are allowed', success: false, code: 'VALIDATION_ERROR' });
    }
    const isVideo = mime.startsWith('video/');
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (req.file.size > maxBytes) {
      return res.status(400).json({ message: `Media is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)`, success: false, code: 'VALIDATION_ERROR' });
    }
    const author = String(req.auth?.partnerId ?? 'anon').replace(/[^a-fA-F0-9]/g, '') || 'anon';
    const stored = await images.upload(req.file.buffer, {
      publicId: `community-${author}-${Date.now()}`,
      ...(isVideo ? { resourceType: 'video' } : {}),
    });
    res.status(200).json({
      message: 'Media uploaded successfully',
      data: {
        url: stored.url,
        mime,
        size: req.file.size,
      },
      success: true,
    });
  }));

  router.post('/:postId/like', validate({ params: z.object({ postId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await like.execute({ partnerId: req.auth?.partnerId, postId: params.postId });
    res.status(200).json({ message: 'Like toggled successfully', data, success: true });
  }));

  router.get('/:postId/comments', validate({ params: z.object({ postId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await comments.execute({ partnerId: req.auth?.partnerId, postId: params.postId });
    res.status(200).json({ message: 'Comments retrieved successfully', data, success: true });
  }));

  router.post('/:postId/comments', validate({ params: z.object({ postId: objectId }), body: CommentSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await comment.execute({ partnerId: req.auth?.partnerId, postId: params.postId, ...body });
    res.status(200).json({ message: 'Comment added successfully', data, success: true });
  }));

  router.post('/:postId/save', validate({ params: z.object({ postId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await save.execute({ partnerId: req.auth?.partnerId, postId: params.postId });
    res.status(200).json({ message: 'Save toggled successfully', data, success: true });
  }));

  router.post('/:postId/report', validate({ params: z.object({ postId: objectId }), body: ReportSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await report.execute({ partnerId: req.auth?.partnerId, postId: params.postId, reason: body?.reason });
    res.status(200).json({ message: 'Post reported successfully', data, success: true });
  }));

  router.post('/:postId/pin', validate({ params: z.object({ postId: objectId }), body: PinSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await pin.execute({
      partnerId: req.auth?.partnerId,
      postId: params.postId,
      pinned: body?.pinned,
      pinnedUntil: body?.pinnedUntil ?? null,
    });
    res.status(200).json({ message: body?.pinned ? 'Post pinned to top' : 'Post unpinned', data, success: true });
  }));

  router.put('/:postId', validate({ params: z.object({ postId: objectId }), body: PostEditSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await update.execute({ partnerId: req.auth?.partnerId, postId: params.postId, ...body });
    res.status(200).json({ message: 'Post updated successfully', data, success: true });
  }));

  router.delete('/:postId', validate({ params: z.object({ postId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await remove.execute({ partnerId: req.auth?.partnerId, postId: params.postId });
    res.status(200).json({ message: 'Post deleted successfully', data, success: true });
  }));

  router.get('/analytics/overview', validate({ query: AnalyticsQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await analytics.execute({ days: q?.days });
    res.status(200).json({ message: 'Community analytics retrieved successfully', data, success: true });
  }));

  router.get('/directory', validate({ query: z.object({ q: z.string().trim().min(2).max(40) }) }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await directory.execute({ query: q?.q });
    res.status(200).json({ message: 'Directory retrieved successfully', data, success: true });
  }));

  router.post('/comments/:commentId/like', validate({ params: z.object({ commentId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await like.execute({ partnerId: req.auth?.partnerId, commentId: params.commentId });
    res.status(200).json({ message: 'Like toggled successfully', data, success: true });
  }));

  // Moderation queue — static segments, no clash with `/:postId` routes.
  router.get('/moderation/queue', requireRole('admin'), asyncHandler(async (req, res) => {
    const data = await reported.execute({ limit: req.query?.limit, skip: req.query?.skip });
    res.status(200).json({ message: 'Reported posts retrieved successfully', data, success: true });
  }));

  router.post('/moderation/:postId', requireRole('admin'), validate({ params: z.object({ postId: objectId }), body: z.object({ decision: z.enum(['remove', 'dismiss']) }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await moderate.execute({ postId: params.postId, decision: body.decision });
    void recordAudit({
      actorId: req.auth?.partnerId,
      action: body.decision === 'remove' ? 'moderation.remove' : 'moderation.dismiss',
      targetType: 'post', targetId: params.postId,
    });
    res.status(200).json({ message: body.decision === 'remove' ? 'Post removed' : 'Reports dismissed', data, success: true });
  }));

  return router;
};

export default buildCommunityRouter();
