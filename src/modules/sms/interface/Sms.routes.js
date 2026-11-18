import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { smsService } from '../application/Sms.service.js';

const RecipientSchema = z.object({
  type: z.enum(['prospect', 'partner', 'customer_lead']),
  id: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid recipient id'),
});
const RecipientsSchema = z.array(RecipientSchema).min(1).max(500);
const IdParam = z.object({ id: z.string().trim().min(1).max(64) });

const SendSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  recipients: RecipientsSchema,
  body: z.string().trim().min(3).max(2000),
  scheduledAt: z.string().trim().max(40).optional().nullable(),
});

const QuoteSchema = z.object({ recipients: RecipientsSchema, body: z.string().trim().min(3).max(2000) });
const SuggestSchema = z.object({
  type: z.enum(['prospect', 'partner', 'customer_lead']),
  id: z.string().trim().regex(/^[a-fA-F0-9]{24}$/),
});
const TemplateSchema = z.object({ name: z.string().trim().min(2).max(80), body: z.string().trim().min(3).max(459) });
const SuppressionSchema = z.object({ phone: z.string().trim().min(7).max(20), reason: z.string().trim().max(200).optional() });

export const buildSmsRouter = (deps = {}) => {
  const service = deps.service ?? smsService;
  const router = express.Router();
  router.use(requireAuth);

  router.get('/recipients', validate({ query: z.object({
    type: z.enum(['prospects', 'partners', 'customer_leads']).optional(),
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    id: z.string().trim().regex(/^[a-fA-F0-9]{24}$/).optional(),
  }) }), asyncHandler(async (req, res) => {
    const query = req.validated?.query ?? req.query;
    const type = query.type === 'partners'
      ? 'partners'
      : query.type === 'customer_leads' ? 'customer_leads' : 'prospects';
    const data = await service.recipients(req.auth.partnerId, {
      type,
      q: query.q ?? '',
      limit: query.limit,
      skip: query.skip,
      id: query.id ?? '',
    });
    return sendSuccess(res, { message: 'SMS recipients retrieved', data });
  }));

  router.post('/suggest', validate({ body: SuggestSchema }), asyncHandler(async (req, res) => {
    const data = await service.suggest(req.auth.partnerId, req.validated.body);
    return sendSuccess(res, { message: 'Ora suggestions ready', data });
  }));

  router.post('/quote', validate({ body: QuoteSchema }), asyncHandler(async (req, res) => {
    const data = await service.quote(req.auth.partnerId, req.validated.body);
    return sendSuccess(res, { message: 'SMS quote ready', data });
  }));

  router.post('/send', validate({ body: SendSchema }), asyncHandler(async (req, res) => {
    const data = await service.send(req.auth.partnerId, req.validated.body);
    return sendSuccess(res, { statusCode: 201, message: data.status === 'scheduled' ? 'SMS scheduled' : 'SMS queued', data });
  }));

  router.get('/campaigns', validate({ query: z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    status: z.enum(['scheduled', 'sending', 'sent', 'partial', 'failed', 'cancelled']).optional(),
  }) }), asyncHandler(async (req, res) => {
    const data = await service.history(req.auth.partnerId, req.validated?.query ?? req.query);
    return sendSuccess(res, { message: 'SMS history retrieved', data });
  }));

  router.get('/campaigns/:id', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const data = await service.detail(req.auth.partnerId, req.params.id);
    return sendSuccess(res, { message: 'SMS campaign retrieved', data });
  }));

  router.post('/campaigns/:id/cancel', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const data = await service.cancel(req.auth.partnerId, req.params.id);
    return sendSuccess(res, { message: 'Scheduled SMS cancelled and refunded', data });
  }));

  router.post('/campaigns/:id/retry', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const data = await service.retry(req.auth.partnerId, req.params.id);
    return sendSuccess(res, { message: 'Failed SMS messages queued again', data });
  }));

  router.get('/templates', asyncHandler(async (req, res) => {
    const data = await service.templates(req.auth.partnerId);
    return sendSuccess(res, { message: 'SMS templates retrieved', data });
  }));

  router.post('/templates', validate({ body: TemplateSchema }), asyncHandler(async (req, res) => {
    const data = await service.saveTemplate(req.auth.partnerId, null, req.validated.body);
    return sendSuccess(res, { statusCode: 201, message: 'SMS template created', data });
  }));

  router.patch('/templates/:id', validate({ params: IdParam, body: TemplateSchema }), asyncHandler(async (req, res) => {
    const data = await service.saveTemplate(req.auth.partnerId, req.params.id, req.validated.body);
    return sendSuccess(res, { message: 'SMS template updated', data });
  }));

  router.delete('/templates/:id', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const data = await service.deleteTemplate(req.auth.partnerId, req.params.id);
    return sendSuccess(res, { message: 'SMS template deleted', data });
  }));

  router.get('/suppressions', asyncHandler(async (req, res) => {
    const data = await service.suppressions(req.auth.partnerId);
    return sendSuccess(res, { message: 'SMS opt-outs retrieved', data });
  }));

  router.post('/suppressions', validate({ body: SuppressionSchema }), asyncHandler(async (req, res) => {
    const data = await service.addSuppression(req.auth.partnerId, req.validated.body);
    return sendSuccess(res, { statusCode: 201, message: 'Number added to SMS opt-outs', data });
  }));

  router.delete('/suppressions/:id', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const data = await service.removeSuppression(req.auth.partnerId, req.params.id);
    return sendSuccess(res, { message: 'Number removed from SMS opt-outs', data });
  }));

  return router;
};

export default buildSmsRouter();
