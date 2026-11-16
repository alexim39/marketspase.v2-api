import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { validate } from '../../../shared/http/validate.js';
import { GetAdminSummaryUseCase, ADMIN_SUMMARY_DOMAINS } from '../application/AdminSummary.usecase.js';
import { AdminSummaryRepository } from '../infrastructure/AdminSummary.repository.js';

const SummaryParams = z.object({
  domain: z.enum(ADMIN_SUMMARY_DOMAINS),
});
const SummaryQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).optional().default(30),
});

export const buildAdminSummaryRouter = (deps = {}) => {
  const repo = deps.repo ?? new AdminSummaryRepository();
  const usecase = deps.usecase ?? new GetAdminSummaryUseCase({ repo });
  const auth = deps.auth ?? requireAuth;
  const admin = deps.admin ?? requireRole('admin');

  const router = express.Router();
  router.use(auth);

  router.get(
    '/:domain',
    admin,
    validate({ params: SummaryParams, query: SummaryQuery }),
    asyncHandler(async (req, res) => {
      const params = req.validated?.params ?? req.params;
      const query = req.validated?.query ?? req.query;
      const data = await usecase.execute({ domain: params.domain, days: query.days });
      res.set('Cache-Control', 'private, max-age=30');
      return sendSuccess(res, { message: 'Admin summary retrieved', data });
    }),
  );

  return router;
};

export default buildAdminSummaryRouter();
