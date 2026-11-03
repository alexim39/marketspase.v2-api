import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { recordAudit } from '../../audit/index.js';
import {
  ListPublicPagesUseCase, GetPublicPageUseCase, ResetPublicPageUseCase,
} from '../application/Pages.usecases.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const ListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['all', 'complete', 'partial', 'empty']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});
const IdParam = z.object({ id: objectId });
const ResetSchema = z.object({
  section: z.enum(['hero', 'story', 'opportunity', 'proof', 'contact', 'all']).optional().default('all'),
});

/**
 * Admin → Public Pages desk (landing moderation).
 * All routes behind requireAuth + requireRole('admin'), audited.
 */
export const buildPagesRouter = (deps = {}) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', validate({ query: ListQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const lister = deps.list ?? new ListPublicPagesUseCase({});
    const data = await lister.execute({
      q: q.q, status: q.status && q.status !== 'all' ? q.status : null,
      limit: q.limit, skip: q.skip,
    });
    res.status(200).json({ message: 'Public pages retrieved successfully', data, success: true });
  }));

  router.get('/:id', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const getter = deps.get ?? new GetPublicPageUseCase({});
    const data = await getter.execute({ id: params.id });
    res.status(200).json({ message: 'Public page retrieved successfully', data, success: true });
  }));

  router.patch('/:id/reset', validate({ params: IdParam, body: ResetSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const resetter = deps.reset ?? new ResetPublicPageUseCase({});
    const data = await resetter.execute({ id: params.id, section: body.section ?? 'all' });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'page.reset',
      targetType: 'publicpage', targetId: data.id,
      detail: { section: data.section, cleared: data.cleared },
    });
    res.status(200).json({ message: `Public page section cleared (${data.section})`, data, success: true });
  }));

  return router;
};

export default buildPagesRouter();
