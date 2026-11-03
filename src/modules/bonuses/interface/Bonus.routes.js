import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  ClaimBonusUseCase, CreateBonusCampaignUseCase, GetEligibleBonusUseCase,
  ListBonusCampaignsUseCase, UpdateBonusCampaignUseCase,
} from '../application/Bonus.usecases.js';
import { recordAudit } from '../../audit/index.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const ClaimSchema = z.object({ campaignId: objectId });
const CreateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  message: z.string().trim().max(500).optional().default(''),
  amountNgn: z.coerce.number().int().min(1).max(1000000),
  eligibleAfter: z.coerce.date().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});
const UpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  message: z.string().trim().max(500).optional(),
  amountNgn: z.coerce.number().int().min(1).max(1000000).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  eligibleAfter: z.coerce.date().nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });

/** Member routes — session-owned eligibility + claim. */
export const buildBonusRouter = (deps = {}) => {
  const eligible = deps.eligible ?? new GetEligibleBonusUseCase({});
  const claim = deps.claim ?? new ClaimBonusUseCase({});

  const router = express.Router();
  router.use(requireAuth);

  router.get('/eligible', asyncHandler(async (req, res) => {
    const data = await eligible.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Bonus eligibility retrieved successfully', data, success: true });
  }));

  router.post('/claim', validate({ body: ClaimSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await claim.execute({ partnerId: req.auth?.partnerId, campaignId: body.campaignId });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'bonus.claim',
      targetType: 'bonus', targetId: String(body.campaignId),
      detail: { amount: data.amountNgn, reference: data.reference },
    });
    res.status(200).json({ message: `₦${Number(data.amountNgn).toLocaleString()} bonus claimed into your wallet`, data, success: true });
  }));

  return router;
};

/** Admin routes — campaign desk (create/list/update). */
export const buildAdminBonusRouter = (deps = {}) => {
  const list = deps.list ?? new ListBonusCampaignsUseCase({});
  const create = deps.create ?? new CreateBonusCampaignUseCase({});
  const update = deps.update ?? new UpdateBonusCampaignUseCase({});

  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', asyncHandler(async (req, res) => {
    const data = await list.execute({});
    res.status(200).json({ message: 'Bonus campaigns retrieved successfully', data, success: true });
  }));

  router.post('/', validate({ body: CreateSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await create.execute({ adminId: req.auth?.partnerId, ...body });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'bonus.campaign.create',
      targetType: 'bonus', targetId: String(data.campaign?.id ?? ''),
      detail: { amount: data.campaign?.amountNgn, title: data.campaign?.title },
    });
    res.status(200).json({ message: 'Bonus campaign created successfully', data, success: true });
  }));

  router.patch('/:id', validate({ params: z.object({ id: objectId }), body: UpdateSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await update.execute({ campaignId: params.id, patch: body });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'bonus.campaign.update',
      targetType: 'bonus', targetId: String(params.id),
      detail: body,
    });
    res.status(200).json({ message: 'Bonus campaign updated successfully', data, success: true });
  }));

  return router;
};

export default buildBonusRouter();
