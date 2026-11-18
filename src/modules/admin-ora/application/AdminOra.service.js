import mongoose from 'mongoose';
import { ValidationException, NotFoundException } from '../../../shared/domain/AppError.js';
import {
  OraActionModel,
  OraConversationModel,
  OraEventModel,
  OraPlanModel,
} from '../../ora/infrastructure/Ora.mongo.repository.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';

const DAY_MS = 86400000;
const validId = (value) => mongoose.Types.ObjectId.isValid(String(value ?? ''));
const oid = (value) => new mongoose.Types.ObjectId(String(value));
const num = (value) => Number(value) || 0;
const escape = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (value) => (value ? new Date(value) : null);

const partnerProjection = {
  name: 1, surname: 1, username: 1, email: 1, phone: 1,
  accountState: 1, activatedAt: 1, profileImage: 1, commissionRank: 1,
};

const shapePartner = (row) => (row ? {
  id: String(row._id ?? row.id ?? ''),
  name: [row.name, row.surname].filter(Boolean).join(' ') || row.username || 'Unknown user',
  username: row.username ?? null,
  email: row.email ?? null,
  phone: row.phone ?? null,
  accountState: row.accountState === 'member' ? 'member' : 'partner',
  activatedAt: row.activatedAt ?? null,
  profileImage: row.profileImage ?? null,
  commissionRank: row.commissionRank ?? 'Partner',
} : null);

const shapeConversation = (row) => ({
  id: String(row._id),
  partnerId: String(row.partnerId),
  title: row.title ?? 'New conversation',
  pinned: row.pinned === true,
  messageCount: Number(row.messageCount ?? (row.messages?.length ?? 0)),
  lastMessage: row.lastMessage ? {
    role: row.lastMessage.role,
    content: String(row.lastMessage.content ?? '').slice(0, 240),
    at: row.lastMessage.at ?? null,
  } : null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
  partner: shapePartner(row.partner),
  moderation: {
    flagged: row.moderation?.flagged === true,
    flagReason: row.moderation?.flagReason ?? '',
    flaggedAt: row.moderation?.flaggedAt ?? null,
    hidden: row.moderation?.hidden === true,
    hiddenReason: row.moderation?.hiddenReason ?? '',
    hiddenAt: row.moderation?.hiddenAt ?? null,
    notesCount: Array.isArray(row.moderation?.notes) ? row.moderation.notes.length : 0,
  },
});

const shapeAction = (row, partner = null) => ({
  id: String(row._id),
  partnerId: String(row.partnerId),
  conversationId: row.conversationId ? String(row.conversationId) : null,
  type: row.type,
  title: row.title ?? '',
  label: row.label ?? row.title ?? 'Ora action',
  summary: row.summary ?? '',
  status: row.status ?? 'proposed',
  area: row.area ?? '',
  error: row.error ?? null,
  createdAt: row.createdAt ?? null,
  executedAt: row.executedAt ?? null,
  partner: partner ? shapePartner(partner) : null,
});

const filterFor = ({ partnerId, flagged, hidden, from, to }) => {
  const match = {};
  if (partnerId) {
    if (!validId(partnerId)) throw new ValidationException('Invalid partner id');
    match.partnerId = oid(partnerId);
  }
  if (flagged === 'yes') match['moderation.flagged'] = true;
  if (flagged === 'no') match['moderation.flagged'] = { $ne: true };
  if (hidden === 'yes') match['moderation.hidden'] = true;
  if (hidden === 'no') match['moderation.hidden'] = { $ne: true };
  const fromAt = iso(from);
  const toAt = iso(to);
  if (fromAt || toAt) {
    match.updatedAt = {};
    if (fromAt) match.updatedAt.$gte = fromAt;
    if (toAt) match.updatedAt.$lte = toAt;
  }
  return match;
};

/**
 * Admin-only read/moderation surface. Partner Ora remains session-scoped and
 * untouched; this service only adds an operator view and moderation fields.
 */
export class AdminOraService {
  constructor({
    conversations = OraConversationModel,
    actions = OraActionModel,
    events = OraEventModel,
    plans = OraPlanModel,
    partners = PartnersModel,
  } = {}) {
    Object.assign(this, { conversations, actions, events, plans, partners });
  }

  async listConversations({
    q = '',
    partnerId = null,
    accountState = null,
    flagged = 'all',
    hidden = 'all',
    from = null,
    to = null,
    limit = 25,
    skip = 0,
  } = {}) {
    const lim = Math.min(Math.max(num(limit) || 25, 1), 100);
    const sk = Math.max(num(skip), 0);
    const match = filterFor({ partnerId, flagged, hidden, from, to });
    const needle = String(q ?? '').trim().slice(0, 120);
    const rx = needle ? new RegExp(escape(needle), 'i') : null;
    const partnerStateMatch = accountState === 'member'
      ? { 'partner.accountState': 'member' }
      : accountState === 'partner'
        ? { 'partner.accountState': { $ne: 'member' } }
        : null;

    const base = [
      { $match: match },
      {
        $lookup: {
          from: 'partners',
          localField: 'partnerId',
          foreignField: '_id',
          as: 'partner',
        },
      },
      { $unwind: { path: '$partner', preserveNullAndEmptyArrays: true } },
      ...(rx ? [{
        $match: {
          $or: [
            { title: rx },
            { 'messages.content': rx },
            { 'partner.name': rx },
            { 'partner.surname': rx },
            { 'partner.username': rx },
            { 'partner.email': rx },
          ],
        },
      }] : []),
      ...(partnerStateMatch ? [{ $match: partnerStateMatch }] : []),
    ];

    const [rows, counted] = await Promise.all([
      this.conversations.aggregate([
        ...base,
        { $addFields: { messageCount: { $size: '$messages' }, lastMessage: { $arrayElemAt: ['$messages', -1] } } },
        { $sort: { updatedAt: -1 } },
        { $skip: sk },
        { $limit: lim },
        {
          $project: {
            title: 1, partnerId: 1, pinned: 1, createdAt: 1, updatedAt: 1,
            messageCount: 1, lastMessage: 1, moderation: 1,
            partner: partnerProjection,
          },
        },
      ]),
      this.conversations.aggregate([...base, { $count: 'total' }]),
    ]);
    return {
      items: (rows ?? []).map(shapeConversation),
      total: Number(counted?.[0]?.total ?? 0),
      limit: lim,
      skip: sk,
    };
  }

  async conversation(id) {
    if (!validId(id)) throw new ValidationException('Invalid conversation id');
    const row = await this.conversations.findById(id).lean();
    if (!row) throw new NotFoundException('Conversation not found');
    const [partner, actions, events, plan] = await Promise.all([
      this.partners.findById(row.partnerId).select('name surname username email phone accountState activatedAt profileImage commissionRank').lean(),
      this.actions.find({ conversationId: row._id }).sort({ createdAt: -1 }).limit(50).lean(),
      this.events.find({ conversationId: row._id }).sort({ at: 1 }).limit(200).lean(),
      this.plans.findOne({ partnerId: row.partnerId }).sort({ updatedAt: -1 }).lean(),
    ]);
    return {
      conversation: {
        ...shapeConversation({ ...row, messageCount: row.messages?.length ?? 0, partner }),
        messages: (row.messages ?? []).map((message) => ({
          role: message.role,
          content: message.content,
          at: message.at ?? null,
        })),
        moderation: {
          ...shapeConversation({ ...row, messages: [], partner }).moderation,
          notes: (row.moderation?.notes ?? []).map((note) => ({
            note: note.note,
            by: note.by ? String(note.by) : null,
            at: note.at ?? null,
          })),
        },
      },
      actions: (actions ?? []).map((action) => shapeAction(action, partner)),
      events: (events ?? []).map((event) => ({
        id: String(event._id),
        topic: event.topic,
        messageChars: num(event.messageChars),
        replyChars: num(event.replyChars),
        latencyMs: num(event.latencyMs),
        at: event.at ?? null,
      })),
      plan: plan ? {
        id: String(plan._id),
        dateKey: plan.dateKey,
        items: plan.items ?? [],
        source: plan.source ?? 'partner',
        updatedAt: plan.updatedAt ?? null,
      } : null,
    };
  }

  async overview({ days = 30 } = {}) {
    const windowDays = Math.min(Math.max(num(days) || 30, 1), 90);
    const from = new Date(Date.now() - windowDays * DAY_MS);
    const [conversationRows, actionRows, eventRows, topicRows, dailyRows, activeRows] = await Promise.all([
      this.conversations.aggregate([
        { $match: { updatedAt: { $gte: from } } },
        {
          $group: {
            _id: null,
            conversations: { $sum: 1 },
            messages: { $sum: { $size: '$messages' } },
            flagged: { $sum: { $cond: [{ $eq: ['$moderation.flagged', true] }, 1, 0] } },
            hidden: { $sum: { $cond: [{ $eq: ['$moderation.hidden', true] }, 1, 0] } },
          },
        },
      ]),
      this.actions.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.events.aggregate([
        { $match: { at: { $gte: from } } },
        {
          $group: {
            _id: null,
            exchanges: { $sum: 1 },
            avgLatencyMs: { $avg: '$latencyMs' },
          },
        },
      ]),
      this.events.aggregate([
        { $match: { at: { $gte: from } } },
        { $group: { _id: '$topic', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      this.events.aggregate([
        { $match: { at: { $gte: from } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$at' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.conversations.distinct('partnerId', { updatedAt: { $gte: from } }),
    ]);
    const conversations = conversationRows?.[0] ?? {};
    const actions = Object.fromEntries((actionRows ?? []).map((row) => [row._id, num(row.count)]));
    return {
      windowDays,
      conversations: num(conversations.conversations),
      messages: num(conversations.messages),
      activeUsers: (activeRows ?? []).length,
      flagged: num(conversations.flagged),
      hidden: num(conversations.hidden),
      exchanges: num(eventRows?.[0]?.exchanges),
      avgLatencyMs: Math.round(num(eventRows?.[0]?.avgLatencyMs)),
      actions: {
        proposed: num(actions.proposed),
        executed: num(actions.executed),
        failed: num(actions.failed),
        skipped: num(actions.skipped),
      },
      topics: (topicRows ?? []).map((row) => ({ topic: row._id || 'other', count: num(row.count) })),
      daily: (dailyRows ?? []).map((row) => ({ date: row._id, count: num(row.count) })),
    };
  }

  async listActions({ status = 'all', partnerId = null, limit = 25, skip = 0 } = {}) {
    const lim = Math.min(Math.max(num(limit) || 25, 1), 100);
    const sk = Math.max(num(skip), 0);
    const filter = {};
    if (['proposed', 'executing', 'executed', 'skipped', 'failed'].includes(status)) filter.status = status;
    if (partnerId) {
      if (!validId(partnerId)) throw new ValidationException('Invalid partner id');
      filter.partnerId = oid(partnerId);
    }
    const [rows, total] = await Promise.all([
      this.actions.find(filter).sort({ createdAt: -1 }).skip(sk).limit(lim).lean(),
      this.actions.countDocuments(filter),
    ]);
    const partnerIds = [...new Set((rows ?? []).map((row) => String(row.partnerId)))];
    const partners = partnerIds.length
      ? await this.partners.find({ _id: { $in: partnerIds } }).select('name surname username email phone accountState activatedAt profileImage commissionRank').lean()
      : [];
    const map = new Map((partners ?? []).map((row) => [String(row._id), row]));
    return {
      items: (rows ?? []).map((row) => shapeAction(row, map.get(String(row.partnerId)))),
      total,
      limit: lim,
      skip: sk,
    };
  }

  async flag(id, { flagged = true, reason = '', adminId = null } = {}) {
    if (!validId(id)) throw new ValidationException('Invalid conversation id');
    const row = await this.conversations.findByIdAndUpdate(
      id,
      {
        $set: {
          'moderation.flagged': flagged === true,
          'moderation.flagReason': flagged === true ? String(reason ?? '').slice(0, 300) : '',
          'moderation.flaggedAt': flagged === true ? new Date() : null,
          'moderation.flaggedBy': flagged === true && adminId ? oid(adminId) : null,
        },
      },
      { new: true },
    ).lean();
    if (!row) throw new NotFoundException('Conversation not found');
    return shapeConversation({ ...row, messageCount: row.messages?.length ?? 0, partner: null });
  }

  async addNote(id, { note, adminId = null } = {}) {
    if (!validId(id)) throw new ValidationException('Invalid conversation id');
    const clean = String(note ?? '').trim().slice(0, 1000);
    if (clean.length < 2) throw new ValidationException('Write a note first');
    const row = await this.conversations.findByIdAndUpdate(
      id,
      { $push: { 'moderation.notes': { note: clean, by: adminId ? oid(adminId) : null, at: new Date() } } },
      { new: true },
    ).lean();
    if (!row) throw new NotFoundException('Conversation not found');
    return shapeConversation({ ...row, messages: [], partner: null });
  }

  async setHidden(id, { hidden = true, reason = '', adminId = null } = {}) {
    if (!validId(id)) throw new ValidationException('Invalid conversation id');
    const row = await this.conversations.findByIdAndUpdate(
      id,
      {
        $set: {
          'moderation.hidden': hidden === true,
          'moderation.hiddenAt': hidden === true ? new Date() : null,
          'moderation.hiddenBy': hidden === true && adminId ? oid(adminId) : null,
          'moderation.hiddenReason': hidden === true ? String(reason ?? '').slice(0, 300) : '',
        },
      },
      { new: true },
    ).lean();
    if (!row) throw new NotFoundException('Conversation not found');
    return shapeConversation({ ...row, messages: [], partner: null });
  }
}
