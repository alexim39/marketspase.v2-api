import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requirePermission } from '../../../shared/http/requirePermission.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { validate } from '../../../shared/http/validate.js';
import { PERMISSIONS } from '../../identity-access/domain/Permissions.js';
import { AcceptProlificWomanLeadUseCase } from '../application/AcceptProlificWomanLead.usecase.js';
import { ListInboxLeadsUseCase } from '../application/ListInboxLeads.usecase.js';
import { MongoProlificWomanLeadRepository } from '../infrastructure/Lead.mongo.repository.js';
import { InboxLeadsQuery } from './Lead.validator.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const LeadIdParam = z.object({ leadId: objectId });

export const buildProlificWomanInboxRouter = ({ leads, list, accept } = {}) => {
  const repository = leads ?? new MongoProlificWomanLeadRepository();
  const listLeads = list ?? new ListInboxLeadsUseCase({ leads: repository });
  const acceptLead =
    accept ?? new AcceptProlificWomanLeadUseCase({ leads: repository });
  const router = express.Router();

  router.use(
    requireAuth,
    requirePermission(PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW),
  );

  router.get(
    '/leads',
    validate({ query: InboxLeadsQuery }),
    asyncHandler(async (req, res) => {
      const query = req.validated?.query ?? req.query;
      const data = await listLeads.execute({
        q: query.q ?? '',
        limit: query.limit,
        skip: query.skip,
      });
      return sendSuccess(res, {
        message: 'Prolific Women leads retrieved successfully',
        data,
      });
    }),
  );

  router.post(
    '/leads/:leadId/accept',
    validate({ params: LeadIdParam }),
    asyncHandler(async (req, res) => {
      const params = req.validated?.params ?? req.params;
      const data = await acceptLead.execute({
        partnerId: req.auth?.partnerId,
        leadId: params.leadId,
      });
      return sendSuccess(res, {
        statusCode: 201,
        message: 'Lead accepted — find it in My follow-ups.',
        data,
      });
    }),
  );

  return router;
};

export default buildProlificWomanInboxRouter();
