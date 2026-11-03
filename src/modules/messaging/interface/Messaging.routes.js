import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  GetThreadUseCase, ListContactsUseCase, ListInboxUseCase, ListSentUseCase,
  MarkReadUseCase, SendAnnouncementUseCase, SendDirectUseCase, SendTeamAnnouncementUseCase, UnreadCountUseCase, SearchPeopleUseCase,
} from '../application/Messaging.usecases.js';
import { MongoMessageStore } from '../infrastructure/Messaging.mongo.repository.js';
import { MongoNetworkRepository, isAncestor } from '../../network/infrastructure/Network.mongo.repository.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import { SMS_CHARGE_PER_PAGE } from '../../outreach/domain/Outreach.entity.js';
import { outreachDeps, outreachSms } from '../../outreach/infrastructure/Outreach.store.js';
import { SendBulkSmsUseCase } from '../../outreach/application/Outreach.usecases.js';
import { env } from '../../../shared/config/env.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const DirectSchema = z.object({
  to: objectId,
  body: z.string().trim().min(1).max(2000),
});

const AnnounceSchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(2000),
  scope: z.enum(['direct', 'all']),
});

const TeamAnnounceSchema = z.object({
  teamId: objectId,
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(2000),
});

  const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });
  const ThreadQuery = LimitQuery.extend({ before: z.coerce.date().optional() });

const CounterpartParam = z.object({ counterpartId: objectId });
const MessageIdParam = z.object({ messageId: objectId });
const PeopleQuery = z.object({
  q: z.string().trim().max(60).optional().default(''),
  limit: z.coerce.number().int().min(1).max(25).optional().default(10),
});
const SmsFallbackSchema = z.object({
  to: objectId,
  body: z.string().trim().min(1).max(960),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildMessagingRouter = (deps = {}) => {
  const messages = deps.messages ?? new MongoMessageStore();
  const network = deps.network ?? new MongoNetworkRepository();

  const direct = new SendDirectUseCase({ messages, network });
  const read = new MarkReadUseCase({ messages });
  const unread = new UnreadCountUseCase({ messages });
  const contacts = new ListContactsUseCase({ network });
  const searchPeople = deps.searchPeople ?? new SearchPeopleUseCase({});
  const thread = deps.thread ?? new GetThreadUseCase({ messages, network });
  // Overridable for tests; default wires the standard outreach pipeline.
  const sendSmsFallback = deps.sendSmsFallback ?? null;
  const announce = new SendAnnouncementUseCase({ messages, network });
  const announceTeam = new SendTeamAnnouncementUseCase({ messages });
  const inbox = new ListInboxUseCase({ messages });
  const sent = new ListSentUseCase({ messages });

  const router = express.Router();
  // Session identity is sender/recipient — no ids to tamper with except
  // validated counterpart/message ids (relationship-checked in use cases).
  router.use(requireAuth);

  router.post('/', validate({ body: DirectSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await direct.execute({ senderId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: 'Message sent successfully', data, success: true });
  }));

  router.post('/announcements', validate({ body: AnnounceSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await announce.execute({ senderId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: 'Announcement sent successfully', data, success: true });
  }));

  router.post('/team-announcements', validate({ body: TeamAnnounceSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await announceTeam.execute({ senderId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: 'Team announcement sent successfully', data, success: true });
  }));

  router.get('/inbox', validate({ query: LimitQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await inbox.execute({ partnerId: req.auth?.partnerId, limit: q?.limit });
    res.status(200).json({ message: 'Inbox retrieved successfully', data, success: true });
  }));

  router.get('/sent', validate({ query: LimitQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await sent.execute({ partnerId: req.auth?.partnerId, limit: q?.limit });
    res.status(200).json({ message: 'Sent messages retrieved successfully', data, success: true });
  }));

  router.get('/thread/:counterpartId', validate({ params: CounterpartParam, query: ThreadQuery }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const q = req.validated?.query ?? req.query;
    const data = await thread.execute({ partnerId: req.auth?.partnerId, counterpartId: params.counterpartId, limit: q?.limit, before: q?.before ?? null });
    res.status(200).json({ message: 'Thread retrieved successfully', data, success: true });
  }));

  router.post('/:messageId/read', validate({ params: MessageIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await read.execute({ partnerId: req.auth?.partnerId, messageId: params.messageId });
    res.status(200).json({ message: 'Message marked as read', data, success: true });
  }));

  router.get('/unread-count', asyncHandler(async (req, res) => {
    const data = await unread.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Unread count retrieved successfully', data, success: true });
  }));

  router.get('/contacts', asyncHandler(async (req, res) => {
    const data = await contacts.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Contacts retrieved successfully', data, success: true });
  }));

  // Global people search for starting chats (safe fields only).
  router.get('/people', validate({ query: PeopleQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await searchPeople.execute({
      q: q.q ?? '',
      excludeId: req.auth?.partnerId,
      limit: q.limit,
    });
    res.status(200).json({ message: 'People found', data, success: true });
  }));

  // Routing intel for one counterpart: live presence for anyone (chats
  // are open), masked number only within the business relationship, and
  // the current per-page SMS rate so the approval dialog quotes exactly.
  router.get('/route/:counterpartId', validate({ params: CounterpartParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const me = String(req.auth?.partnerId ?? '');
    const id = String(params.counterpartId);
    const doc = await PartnersModel.findById(id).select('phone lastSeenAt').lean().catch(() => null);
    if (!doc) {
      return res.status(404).json({ message: 'Partner not found', success: false });
    }
    const related = id === me
      || (await isAncestor(network, me, id).catch(() => false))
      || (await isAncestor(network, id, me).catch(() => false));
    const at = doc.lastSeenAt ? new Date(doc.lastSeenAt).getTime() : NaN;
    const mins = Number.isFinite(at) ? (Date.now() - at) / 60000 : Infinity;
    const online = mins <= 5;
    const digits = related ? String(doc.phone ?? '').replace(/\D/g, '') : '';
    const maskedPhone = digits.length >= 7
      ? `${digits.slice(0, 4)}${'•'.repeat(digits.length - 6)}${digits.slice(-2)}`
      : null;
    res.status(200).json({
      message: 'Route resolved successfully',
      data: {
        online,
        presence: online ? 'online' : mins <= 60 ? 'recent' : null,
        lastSeenAt: doc.lastSeenAt ?? null,
        maskedPhone,
        smsUnitCost: Number(SMS_CHARGE_PER_PAGE) || 0,
      },
      success: true,
    });
  }));

  // SMS fallback for an offline counterpart — approved per message on the
  // client. Resolves the number server-side (never exposed), charges the
  // sender's wallet through the standard outreach pipeline.
  router.post('/sms-fallback', validate({ body: SmsFallbackSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const me = String(req.auth?.partnerId ?? '');
    const id = String(body.to);
    const related = (await isAncestor(network, me, id).catch(() => false))
      || (await isAncestor(network, id, me).catch(() => false));
    if (!related) {
      return res.status(403).json({ message: 'SMS fallback is limited to your upline and downline', success: false });
    }
    const target = await PartnersModel.findById(id).select('phone').lean().catch(() => null);
    const phone = String(target?.phone ?? '').trim();
    if (!phone) {
      return res.status(422).json({ message: 'No phone number on file for this contact', success: false });
    }
    const sender = sendSmsFallback ?? (() => {
      const stores = outreachDeps({});
      const link = outreachSms({ smsEnv: env.sms });
      return new SendBulkSmsUseCase({ ...stores, sms: link.sms, smsEnabled: link.smsEnabled });
    })();
    const data = await sender.execute({ partnerId: me, to: [phone], body: body.body });
    res.status(200).json({ message: `SMS sent to ${data.sent} of ${data.total} recipient${data.total === 1 ? '' : 's'}`, data, success: true });
  }));

  return router;
};

export default buildMessagingRouter();
