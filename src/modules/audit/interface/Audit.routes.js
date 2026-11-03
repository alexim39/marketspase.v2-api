import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { ListAuditUseCase } from '../application/Audit.usecases.js';
import { MongoAuditStore } from '../infrastructure/Audit.store.js';
import { AUDIT_ACTIONS } from '../domain/AuditLog.js';

const AuditQuery = z.object({
  actorId: z.string().trim().max(64).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  skip: z.coerce.number().int().min(0).optional().default(0),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildAuditRouter = (deps = {}) => {
  const store = deps.audit ?? new MongoAuditStore();
  const list = new ListAuditUseCase({ audit: store });

  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', validate({ query: AuditQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await list.execute({
      actorId: q?.actorId ?? null,
      action: q?.action ?? null,
      from: q?.from ?? null,
      to: q?.to ?? null,
      limit: q?.limit,
      skip: q?.skip,
    });
    res.status(200).json({ message: 'Audit log retrieved successfully', data, success: true });
  }));

  return router;
};

export default buildAuditRouter();
