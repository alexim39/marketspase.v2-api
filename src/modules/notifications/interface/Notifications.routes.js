import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  GetNotificationFeedUseCase, MarkNotificationsReadUseCase,
} from '../application/Notifications.usecases.js';
import {
  ArchiveNotificationUseCase, BulkCenterUseCase, GetPreferencesUseCase, ListCenterUseCase,
  MarkStoredReadUseCase, MarkStoredUnreadUseCase, NotificationStatsUseCase, NotifyUseCase,
  RecordClickUseCase, RemoveNotificationUseCase, RemovePushSubscriptionUseCase,
  SavePushSubscriptionUseCase, UpdatePreferencesUseCase,
} from '../application/NotificationsCenter.usecases.js';
import { env } from '../../../shared/config/env.js';
import { MongoNotificationStore } from '../infrastructure/Notifications.mongo.repository.js';
import { MongoStoredNotificationStore } from '../infrastructure/StoredNotifications.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoCommissionLedger } from '../../billing/infrastructure/Billing.mongo.repository.js';
import { MongoCommunityStore } from '../../community/infrastructure/Community.mongo.repository.js';

const FeedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});
const MarkReadSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(300)).min(1).max(200),
});
const objectIdParam = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Stored notifications only — derived items use POST /read');
const StoredIdParam = z.object({ id: objectIdParam });
const CenterListQuery = z.object({
  unread: z.union([z.boolean(), z.enum(['true', 'false'])]).optional().default(false),
  q: z.string().trim().max(120).optional().default(''),
  cursor: objectIdParam.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
const BulkSchema = z.object({ action: z.enum(['read-all', 'archive-all', 'delete-all']) });
const StatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional().default(30),
});
const PushSubscriptionSchema = z.object({
  endpoint: z.string().trim().min(1).max(2000),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(500),
    auth: z.string().trim().min(1).max(500),
  }),
  userAgent: z.string().trim().max(500).optional().default(''),
});
const PushEndpointSchema = z.object({
  endpoint: z.string().trim().min(1).max(2000),
});
const ChannelRow = z.object({
  inApp: z.boolean().optional().default(true),
  email: z.boolean().optional().default(false),
  sms: z.boolean().optional().default(false),
  push: z.boolean().optional().default(false),
});
const PreferencesSchema = z.object({
  channels: z.record(z.string(), ChannelRow).optional().default({}),
  emailDigest: z.enum(['immediate', 'daily', 'weekly', 'off']).optional().default('immediate'),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildNotificationsRouter = (deps = {}) => {
  const prospects = deps.prospects ?? new MongoProspectRepository();
  const ledger = deps.ledger ?? new MongoCommissionLedger();
  const reads = deps.reads ?? new MongoNotificationStore();
  const community = deps.community ?? new MongoCommunityStore();

  const feed = new GetNotificationFeedUseCase({ prospects, ledger, reads, community });
  const markRead = new MarkNotificationsReadUseCase({ reads });
  const centerStore = deps.centerStore ?? new MongoStoredNotificationStore();
  const center = new ListCenterUseCase({ stored: centerStore, feed });
  const notify = new NotifyUseCase({ stored: centerStore });
  const markStoredRead = new MarkStoredReadUseCase({ stored: centerStore });
  const markStoredUnread = new MarkStoredUnreadUseCase({ stored: centerStore });
  const recordClick = new RecordClickUseCase({ stored: centerStore });
  const archiveOne = new ArchiveNotificationUseCase({ stored: centerStore });
  const removeOne = new RemoveNotificationUseCase({ stored: centerStore });
  const bulk = new BulkCenterUseCase({ stored: centerStore });
  const getPrefs = new GetPreferencesUseCase({ stored: centerStore });
  const savePrefs = new UpdatePreferencesUseCase({ stored: centerStore });
  const stats = new NotificationStatsUseCase({ stored: centerStore });
  const saveSub = new SavePushSubscriptionUseCase({ stored: centerStore });
  const removeSub = new RemovePushSubscriptionUseCase({ stored: centerStore });

  const router = express.Router();
  // Session identity only — partners see exactly their own feed.
  router.use(requireAuth);

  router.get('/mine', validate({ query: FeedQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await feed.execute({ partnerId: req.auth?.partnerId, limit: q?.limit });
    res.status(200).json({ message: 'Notifications retrieved successfully', data, success: true });
  }));

  router.post('/read', validate({ body: MarkReadSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await markRead.execute({ partnerId: req.auth?.partnerId, ids: body.ids });
    res.status(200).json({ message: 'Notifications marked as read', data, success: true });
  }));

  router.get('/list', validate({ query: CenterListQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await center.execute({
      partnerId: req.auth?.partnerId,
      unreadOnly: q?.unread === true || q?.unread === 'true',
      search: q?.q ?? '',
      cursor: q?.cursor,
      limit: q?.limit,
    });
    res.status(200).json({ message: 'Notification center retrieved successfully', data, success: true });
  }));

  router.post('/:id/read', validate({ params: StoredIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await markStoredRead.execute({ partnerId: req.auth?.partnerId, id: params.id });
    res.status(200).json({ message: 'Notification marked as read', data, success: true });
  }));

  router.post('/:id/unread', validate({ params: StoredIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await markStoredUnread.execute({ partnerId: req.auth?.partnerId, id: params.id });
    res.status(200).json({ message: 'Notification marked as unread', data, success: true });
  }));

  router.post('/:id/open', validate({ params: StoredIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await recordClick.execute({ partnerId: req.auth?.partnerId, id: params.id });
    res.status(200).json({ message: 'Notification click recorded', data, success: true });
  }));

  router.post('/:id/archive', validate({ params: StoredIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await archiveOne.execute({ partnerId: req.auth?.partnerId, id: params.id });
    res.status(200).json({ message: 'Notification archived', data, success: true });
  }));

  router.delete('/:id', validate({ params: StoredIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await removeOne.execute({ partnerId: req.auth?.partnerId, id: params.id });
    res.status(200).json({ message: 'Notification deleted', data, success: true });
  }));

  router.post('/bulk', validate({ body: BulkSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await bulk.execute({ partnerId: req.auth?.partnerId, action: body.action });
    res.status(200).json({ message: 'Bulk action completed', data, success: true });
  }));

  router.get('/preferences', asyncHandler(async (req, res) => {
    const data = await getPrefs.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Preferences retrieved successfully', data, success: true });
  }));

  router.put('/preferences', validate({ body: PreferencesSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await savePrefs.execute({ partnerId: req.auth?.partnerId, prefs: body });
    res.status(200).json({ message: 'Preferences saved successfully', data, success: true });
  }));

  router.get('/stats', validate({ query: StatsQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await stats.execute({ partnerId: req.auth?.partnerId, days: q?.days });
    res.status(200).json({ message: 'Notification analytics retrieved successfully', data, success: true });
  }));

  router.get('/push/vapid-key', asyncHandler(async (_req, res) => {
    res.status(200).json({
      message: 'Push configuration retrieved successfully',
      data: { publicKey: env.push.publicKey || null, enabled: env.push.enabled },
      success: true,
    });
  }));

  router.post('/push/subscriptions', validate({ body: PushSubscriptionSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await saveSub.execute({ partnerId: req.auth?.partnerId, subscription: body });
    res.status(200).json({ message: 'Push subscription saved', data, success: true });
  }));

  router.post('/push/subscriptions/unsubscribe', validate({ body: PushEndpointSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await removeSub.execute({ partnerId: req.auth?.partnerId, endpoint: body.endpoint });
    res.status(200).json({ message: 'Push subscription removed', data, success: true });
  }));

  return router;
};

export default buildNotificationsRouter();
