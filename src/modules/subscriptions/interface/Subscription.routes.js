import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { recordAudit } from '../../audit/index.js';
import {
  DeleteSubscriptionUseCase, ExportSubscriptionsUseCase,
  ListSubscriptionsUseCase, SetSubscriptionStatusUseCase,
} from '../application/Subscription.usecases.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const ListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['Subscribed', 'Unsubscribed', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

const ExportQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['Subscribed', 'Unsubscribed', 'all']).optional(),
});

const IdParam = z.object({ id: objectId });
const StatusSchema = z.object({ status: z.enum(['Subscribed', 'Unsubscribed']) });

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildSubscriptionsRouter = (deps = {}) => {
  const list = deps.list ?? new ListSubscriptionsUseCase({});
  const remove = deps.remove ?? new DeleteSubscriptionUseCase({});
  const setStatus = deps.setStatus ?? new SetSubscriptionStatusUseCase({});
  const exporter = deps.exporter ?? new ExportSubscriptionsUseCase({});

  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', validate({ query: ListQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await list.execute({
      q: q.q, status: q.status && q.status !== 'all' ? q.status : null,
      limit: q.limit, skip: q.skip,
    });
    res.status(200).json({ message: 'Subscriptions retrieved successfully', data, success: true });
  }));

  // NOTE: static `/export` precedes `/:id` or Express swallows it as an id.
  router.get('/export', validate({ query: ExportQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await exporter.execute({
      q: q.q, status: q.status && q.status !== 'all' ? q.status : null,
    });
    res.status(200).json({ message: 'Subscription export ready', data, success: true });
  }));

  router.patch('/:id', validate({ params: IdParam, body: StatusSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await setStatus.execute({ id: params.id, status: body.status });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'subscription.status',
      targetType: 'subscription', targetId: data.id,
      detail: { status: data.status },
    });
    res.status(200).json({ message: `Subscription marked as ${data.status.toLowerCase()}`, data, success: true });
  }));

  router.delete('/:id', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await remove.execute({ id: params.id });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'subscription.delete',
      targetType: 'subscription', targetId: data.id,
      detail: { email: data.email },
    });
    res.status(200).json({ message: `Subscription deleted${data.email ? ` (${data.email})` : ''}`, data, success: true });
  }));

  return router;
};

export default buildSubscriptionsRouter();
