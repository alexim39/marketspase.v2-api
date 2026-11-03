import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { env } from '../../../shared/config/env.js';
import {
  AskOraUseCase, DeleteOraConversationUseCase, GetOraAnalyticsUseCase, GetOraContextUseCase,
  GetOraConversationUseCase, ListOraConversationsUseCase, PinOraConversationUseCase,
} from '../application/Ora.usecases.js';
import { OraContextAssembler } from '../application/Ora.context.js';
import { DeepSeekClient } from '../infrastructure/DeepSeek.client.js';
import { MongoOraAnalyticsStore, MongoOraConversationStore } from '../infrastructure/Ora.mongo.repository.js';
import { GetMyProgressionUseCase } from '../../progression/application/Progression.usecases.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { ListGoalsUseCase } from '../../goals/application/Goals.usecases.js';
import { MongoGoalStore } from '../../goals/infrastructure/Goals.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { ListUpcomingUseCase } from '../../events/application/Events.usecases.js';
import { MongoEventStore } from '../../events/infrastructure/Events.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoCommunityStore } from '../../community/infrastructure/Community.mongo.repository.js';
import { MongoReportStore } from '../../reports/infrastructure/Reports.mongo.repository.js';
import { MongoOrderReader } from '../../billing/infrastructure/Billing.mongo.repository.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const ChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: objectId.optional(),
});
const ConversationIdParam = z.object({ conversationId: objectId });
const ConversationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  q: z.string().trim().max(80).optional().default(''),
});
const PinSchema = z.object({ pinned: z.boolean() });
const AnalyticsQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional().default(30),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildOraRouter = (deps = {}) => {
  const progress = deps.progress ?? new MongoProgressionStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const orders = deps.orders ?? new MongoOrderReader();
  const prospects = deps.prospects ?? new MongoProspectRepository();
  const conversations = deps.conversations ?? new MongoOraConversationStore();

  // Recognition omitted on purpose — Ora reads the journey like the
  // Journey page but never auto-posts promotions from a chat turn.
  const journey = deps.journey ?? new GetMyProgressionUseCase({
    progress,
    network,
    orders,
    recognition: null,
    prospects,
    community: deps.community ?? new MongoCommunityStore(),
    eventStore: deps.eventRsvps ?? new MongoEventStore(),
    reports: deps.reportStore ?? new MongoReportStore(),
  });
  const goals = deps.goals ?? new ListGoalsUseCase({
    goals: deps.goalStore ?? new MongoGoalStore(), orders, prospects, network,
  });
  const events = deps.events ?? new ListUpcomingUseCase({
    events: deps.eventStore ?? new MongoEventStore(), network, progress,
  });
  const notifications = deps.notifications ?? new MongoStoredNotificationStore();
  const partners = deps.partners ?? new MongoPartnerRepository();

  const context = deps.context ?? new OraContextAssembler({ journey, goals, prospects, events, notifications, partners });
  const client = deps.client ?? new DeepSeekClient({ ...env.ora, post: deps.post });
  const analytics = deps.analytics ?? new MongoOraAnalyticsStore();
  const ask = deps.ask ?? new AskOraUseCase({ conversations, client, context, analytics, dailyLimit: env.ora.dailyLimit });
  const oraContext = new GetOraContextUseCase({ context });
  const list = new ListOraConversationsUseCase({ conversations });
  const detail = new GetOraConversationUseCase({ conversations });
  const pin = new PinOraConversationUseCase({ conversations });
  const remove = new DeleteOraConversationUseCase({ conversations });
  const stats = new GetOraAnalyticsUseCase({ analytics });

  const router = express.Router();
  // Session identity only — every partner chats as themselves.
  router.use(requireAuth);

  router.get('/context', asyncHandler(async (req, res) => {
    const data = await oraContext.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Ora context retrieved successfully', data, success: true });
  }));

  router.post('/chat', validate({ body: ChatSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await ask.execute({
      partnerId: req.auth?.partnerId,
      message: body.message,
      conversationId: body.conversationId,
    });
    res.status(200).json({ message: 'Ora replied successfully', data, success: true });
  }));

  router.get('/analytics', validate({ query: AnalyticsQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await stats.execute({ partnerId: req.auth?.partnerId, days: q?.days });
    res.status(200).json({ message: 'Ora analytics retrieved successfully', data, success: true });
  }));

  router.get('/conversations', validate({ query: ConversationsQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await list.execute({ partnerId: req.auth?.partnerId, limit: q?.limit, q: q?.q });
    res.status(200).json({ message: 'Conversations retrieved successfully', data, success: true });
  }));

  router.put('/conversations/:conversationId/pin', validate({ params: ConversationIdParam, body: PinSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await pin.execute({ partnerId: req.auth?.partnerId, conversationId: params.conversationId, pinned: body?.pinned });
    res.status(200).json({ message: body?.pinned ? 'Conversation pinned' : 'Conversation unpinned', data, success: true });
  }));

  router.get('/conversations/:conversationId', validate({ params: ConversationIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await detail.execute({ partnerId: req.auth?.partnerId, conversationId: params.conversationId });
    res.status(200).json({ message: 'Conversation retrieved successfully', data, success: true });
  }));

  router.delete('/conversations/:conversationId', validate({ params: ConversationIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await remove.execute({ partnerId: req.auth?.partnerId, conversationId: params.conversationId });
    res.status(200).json({ message: 'Conversation deleted successfully', data, success: true });
  }));

  return router;
};

export default buildOraRouter();
