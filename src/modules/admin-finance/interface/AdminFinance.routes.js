import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { validate } from '../../../shared/http/validate.js';
import { ListFinanceTransactionsUseCase } from '../application/ListFinanceTransactions.usecase.js';

const FinanceTransactionsQuery = z.object({
  type: z.enum(['all', 'deposits', 'withdrawals', 'refunds']).optional().default('all'),
  status: z.string().trim().max(40).optional().default(''),
  q: z.string().trim().max(120).optional().default(''),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  skip: z.coerce.number().int().min(0).optional().default(0),
});

export const buildAdminFinanceRouter = (deps = {}) => {
  const usecase = deps.usecase ?? new ListFinanceTransactionsUseCase({ repo: deps.repo });
  const auth = deps.auth ?? requireAuth;
  const admin = deps.admin ?? requireRole('admin');
  const router = express.Router();
  router.use(auth);

  router.get(
    '/transactions',
    admin,
    validate({ query: FinanceTransactionsQuery }),
    asyncHandler(async (req, res) => {
      const q = req.validated?.query ?? req.query;
      const data = await usecase.execute({
        type: q.type,
        status: q.status,
        q: q.q,
        from: q.from,
        to: q.to,
        limit: q.limit,
        skip: q.skip,
      });
      res.set('Cache-Control', 'private, max-age=15');
      return sendSuccess(res, { message: 'Finance transactions retrieved', data });
    }),
  );

  return router;
};

export default buildAdminFinanceRouter();
