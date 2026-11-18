import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { recordAudit } from '../../audit/index.js';
import { AdminOraService } from '../application/AdminOra.service.js';

const IdParam = z.object({ id: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid conversation id') });
const FlagSchema = z.object({ flagged: z.boolean().optional().default(true), reason: z.string().trim().max(300).optional().default('') });
const NoteSchema = z.object({ note: z.string().trim().min(2).max(1000) });
const HideSchema = z.object({ hidden: z.boolean().optional().default(true), reason: z.string().trim().max(300).optional().default('') });

const listQuery = z.object({
  q: z.string().trim().max(120).optional().default(''),
  partnerId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/).optional(),
  accountState: z.enum(['member', 'partner']).optional(),
  flagged: z.enum(['all', 'yes', 'no']).optional().default('all'),
  hidden: z.enum(['all', 'yes', 'no']).optional().default('all'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  skip: z.coerce.number().int().min(0).optional().default(0),
});

const actionQuery = z.object({
  status: z.enum(['all', 'proposed', 'executing', 'executed', 'skipped', 'failed']).optional().default('all'),
  partnerId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  skip: z.coerce.number().int().min(0).optional().default(0),
});

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildAdminOraRouter = (deps = {}) => {
  const service = deps.service ?? new AdminOraService(deps);
  const audit = deps.audit ?? recordAudit;
  const auth = deps.auth ?? requireAuth;
  const admin = deps.admin ?? requireRole('admin');
  const router = express.Router();
  router.use(auth, admin);

  router.get('/overview', validate({ query: z.object({
    days: z.coerce.number().int().min(1).max(90).optional().default(30),
  }) }), asyncHandler(async (req, res) => {
    const data = await service.overview({ days: req.validated?.query?.days ?? 30 });
    return sendSuccess(res, { message: 'Ora overview retrieved', data });
  }));

  router.get('/conversations', validate({ query: listQuery }), asyncHandler(async (req, res) => {
    const data = await service.listConversations(req.validated?.query ?? req.query);
    return sendSuccess(res, { message: 'Ora conversations retrieved', data });
  }));

  router.get('/conversations/:id', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const data = await service.conversation(req.params.id);
    void audit({
      actorId: req.auth?.partnerId,
      action: 'ora.view',
      targetType: 'ora-conversation',
      targetId: req.params.id,
      detail: { partnerId: data?.conversation?.partnerId ?? null },
    });
    return sendSuccess(res, { message: 'Ora conversation retrieved', data });
  }));

  router.post('/conversations/:id/flag', validate({ params: IdParam, body: FlagSchema }), asyncHandler(async (req, res) => {
    const data = await service.flag(req.params.id, {
      ...req.validated.body,
      adminId: req.auth?.partnerId,
    });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'ora.flag',
      targetType: 'ora-conversation',
      targetId: req.params.id,
      detail: { flagged: data.moderation?.flagged === true, reason: req.validated.body.reason ?? '' },
    });
    return sendSuccess(res, { message: data.moderation?.flagged ? 'Conversation flagged' : 'Conversation unflagged', data });
  }));

  router.post('/conversations/:id/notes', validate({ params: IdParam, body: NoteSchema }), asyncHandler(async (req, res) => {
    const data = await service.addNote(req.params.id, {
      note: req.validated.body.note,
      adminId: req.auth?.partnerId,
    });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'ora.note',
      targetType: 'ora-conversation',
      targetId: req.params.id,
      detail: { chars: req.validated.body.note.length },
    });
    return sendSuccess(res, { statusCode: 201, message: 'Admin note added', data });
  }));

  router.post('/conversations/:id/hide', validate({ params: IdParam, body: HideSchema }), asyncHandler(async (req, res) => {
    const hidden = req.validated.body.hidden !== false;
    const data = await service.setHidden(req.params.id, {
      hidden,
      reason: req.validated.body.reason ?? '',
      adminId: req.auth?.partnerId,
    });
    void audit({
      actorId: req.auth?.partnerId,
      action: hidden ? 'ora.hide' : 'ora.restore',
      targetType: 'ora-conversation',
      targetId: req.params.id,
      detail: { reason: req.validated.body.reason ?? '' },
    });
    return sendSuccess(res, { message: hidden ? 'Conversation hidden from partner' : 'Conversation restored', data });
  }));

  router.get('/actions', validate({ query: actionQuery }), asyncHandler(async (req, res) => {
    const data = await service.listActions(req.validated?.query ?? req.query);
    return sendSuccess(res, { message: 'Ora actions retrieved', data });
  }));

  router.get('/export', validate({ query: listQuery }), asyncHandler(async (req, res) => {
    const query = req.validated?.query ?? req.query;
    const rows = [];
    const limit = 100;
    let skip = 0;
    while (rows.length < 5000) {
      const page = await service.listConversations({ ...query, limit, skip });
      rows.push(...page.items);
      if (page.items.length < limit) break;
      skip += limit;
    }
    const header = ['Partner', 'Username', 'Activation', 'Title', 'Messages', 'Flagged', 'Hidden', 'Last activity', 'Last message'];
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push([
        row.partner?.name ?? '',
        row.partner?.username ?? '',
        row.partner?.accountState ?? '',
        row.title,
        row.messageCount,
        row.moderation?.flagged ? 'yes' : 'no',
        row.moderation?.hidden ? 'yes' : 'no',
        row.updatedAt ?? '',
        row.lastMessage?.content ?? '',
      ].map(csvCell).join(','));
    }
    void audit({
      actorId: req.auth?.partnerId,
      action: 'ora.export',
      targetType: 'ora-conversation',
      targetId: null,
      detail: { rows: rows.length },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ora-conversations.csv"');
    return res.status(200).send(lines.join('\n'));
  }));

  return router;
};

export default buildAdminOraRouter();
