import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { validate } from '../../../shared/http/validate.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { ListLeadsUseCase } from '../application/ListLeads.usecase.js';
import { DeleteProlificWomanLeadUseCase } from '../application/DeleteProlificWomanLead.usecase.js';
import { MongoProlificWomanLeadRepository } from '../infrastructure/Lead.mongo.repository.js';
import { recordAudit } from '../../audit/index.js';
import { ListLeadsQuery } from './Lead.validator.js';

const LeadIdParam = z.object({
  id: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid lead id'),
});

export const buildProlificWomanAdminLeadRouter = ({ leads, list, remove } = {}) => {
  const repository = leads ?? new MongoProlificWomanLeadRepository();
  const listLeads = list ?? new ListLeadsUseCase({ leads: repository });
  const removeLead = remove ?? new DeleteProlificWomanLeadUseCase({ leads: repository });
  const router = express.Router();

  router.use(requireAuth, requireRole('admin'));

  router.get(
    '/leads',
    validate({ query: ListLeadsQuery }),
    asyncHandler(async (req, res) => {
      const query = req.validated?.query ?? req.query;
      const data = await listLeads.execute({
        q: query.q ?? '',
        limit: query.limit,
        skip: query.skip,
        status: query.status ?? 'all',
      });
      return sendSuccess(res, {
        message: 'Leads retrieved successfully',
        data,
      });
    }),
  );

  router.delete(
    '/leads/:id',
    validate({ params: LeadIdParam }),
    asyncHandler(async (req, res) => {
      const params = req.validated?.params ?? req.params;
      const data = await removeLead.execute({ leadId: params.id });
      void recordAudit({
        actorId: req.auth?.partnerId, action: 'prolificwomanlead.delete',
        targetType: 'prolificwoman-lead', targetId: String(data.id),
      });
      return sendSuccess(res, {
        message: 'Lead deleted successfully',
        data,
      });
    }),
  );

  return router;
};

export default buildProlificWomanAdminLeadRouter();
