import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { validate } from '../../../shared/http/validate.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import { buildSmsSender } from '../../notifications/infrastructure/SmsSender.js';
import { env } from '../../../shared/config/env.js';
import { MongoMessageStore } from '../../messaging/infrastructure/Messaging.mongo.repository.js';
import { MongoMentorHandoffRepository } from '../infrastructure/MentorHandoff.mongo.repository.js';
import {
  ListMentorHandoffTemplatesUseCase,
  ListMentorHandoffsUseCase,
  MarkMentorHandoffContactedUseCase,
  SendMentorHandoffIntroUseCase,
  UpdateMentorContactPreferenceUseCase,
} from '../application/MentorHandoff.usecases.js';
import { MENTOR_CONTACT_PREFERENCES } from '../domain/MentorHandoff.domain.js';

const id = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const ListQuery = z.object({
  status: z.enum(['pending', 'contacted', 'closed']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const SendBody = z.object({
  templateKey: z.string().trim().min(1).max(80),
});

const ContactedBody = z.object({
  note: z.string().trim().max(500).optional().default(''),
});

const PreferenceBody = z.object({
  preference: z.enum(MENTOR_CONTACT_PREFERENCES),
  consent: z.boolean().optional().default(false),
});

export const buildMentorHandoffRouter = (deps = {}) => {
  const handoffs = deps.handoffs ?? new MongoMentorHandoffRepository();
  const partners = deps.partners ?? PartnersModel;
  const messages = deps.messages ?? new MongoMessageStore();
  const sms = deps.sms ?? buildSmsSender(env.sms);
  const mail = deps.mail;
  const list = deps.list ?? new ListMentorHandoffsUseCase({ handoffs });
  const templates = deps.templates ?? new ListMentorHandoffTemplatesUseCase();
  const send = deps.send ?? new SendMentorHandoffIntroUseCase({
    handoffs,
    partners,
    messages,
    sms,
    ...(mail ? { mail } : {}),
  });
  const contacted = deps.contacted ?? new MarkMentorHandoffContactedUseCase({ handoffs });
  const preference = deps.preference ?? new UpdateMentorContactPreferenceUseCase({ handoffs, partners });
  const auth = deps.auth ?? requireAuth;

  const router = express.Router();
  router.use(auth);

  router.get('/', validate({ query: ListQuery }), asyncHandler(async (req, res) => {
    const query = req.validated?.query ?? req.query;
    // Unpaginated callers (older clients) keep the previous 200-row window;
    // the paginated UI always sends page/limit.
    const paged = query.page !== undefined || query.limit !== undefined;
    const result = await list.execute(req.auth.partnerId, {
      status: query.status,
      page: query.page ?? 1,
      limit: paged ? (query.limit ?? 20) : 200,
    });
    return sendSuccess(res, { data: result.data, meta: result.meta });
  }));

  router.get('/templates', asyncHandler(async (_req, res) => {
    return sendSuccess(res, { data: templates.execute() });
  }));

  router.patch('/preference', validate({ body: PreferenceBody }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await preference.execute({
      partnerId: req.auth.partnerId,
      preference: body.preference,
      consent: body.consent,
    });
    return sendSuccess(res, { message: 'Mentor contact preference saved', data });
  }));

  router.post('/:id/send', validate({ params: z.object({ id }), body: SendBody }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await send.execute({
      mentorId: req.auth.partnerId,
      handoffId: params.id,
      templateKey: body.templateKey,
    });
    return sendSuccess(res, { message: 'Welcome message sent by email, SMS and Chat', data });
  }));

  router.post('/:id/contacted', validate({ params: z.object({ id }), body: ContactedBody }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await contacted.execute({
      mentorId: req.auth.partnerId,
      handoffId: params.id,
      note: body.note,
    });
    return sendSuccess(res, { message: 'Mentor task updated', data });
  }));

  return router;
};

export default buildMentorHandoffRouter;
