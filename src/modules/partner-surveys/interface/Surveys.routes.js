import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { recordAudit } from '../../audit/index.js';
import {
  ListPartnerSurveysUseCase, GetPartnerSurveyUseCase, DeletePartnerSurveyUseCase,
} from '../application/Surveys.usecases.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const ListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});
const IdParam = z.object({ id: objectId });

/**
 * Admin → Partner surveys desk (public :4202 submissions).
 * All routes behind requireAuth + requireRole('admin'), audited on delete.
 */
export const buildPartnerSurveysRouter = (deps = {}) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', validate({ query: ListQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const lister = deps.list ?? new ListPartnerSurveysUseCase({});
    const data = await lister.execute({ q: q.q, limit: q.limit, skip: q.skip });
    res.status(200).json({ message: 'Partner surveys retrieved successfully', data, success: true });
  }));

  router.get('/:id', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const getter = deps.get ?? new GetPartnerSurveyUseCase({});
    const data = await getter.execute({ id: params.id });
    res.status(200).json({ message: 'Partner survey retrieved successfully', data, success: true });
  }));

  router.delete('/:id', validate({ params: IdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const remover = deps.remove ?? new DeletePartnerSurveyUseCase({});
    const data = await remover.execute({ id: params.id });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'partnersurvey.delete',
      targetType: 'partnersurvey', targetId: data.id,
      detail: { name: data.name },
    });
    res.status(200).json({ message: `Survey deleted${data.name ? ` (${data.name})` : ''}`, data, success: true });
  }));

  return router;
};

export default buildPartnerSurveysRouter();
