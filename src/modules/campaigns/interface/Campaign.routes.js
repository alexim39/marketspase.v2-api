import express from 'express';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { recordAudit } from '../../audit/index.js';
import { MongoCampaignRepository } from '../infrastructure/Campaign.mongo.repository.js';
import {
  ActivateGrowthCampaignUseCase,
  AllocatePartnersUseCase,
  CancelGrowthCampaignUseCase,
  CreateGrowthCampaignUseCase,
  EndGrowthCampaignUseCase,
  GetCampaignAttributionUseCase,
  GetCampaignQueueUseCase,
  GetMyAllocationUseCase,
  GetMyGrowthCampaignUseCase,
  ListAdminAllocationsUseCase,
  ListAdminGrowthCampaignsUseCase,
  ListMyGrowthCampaignsUseCase,
  ListMyPlacedPartnersUseCase,
  OverrideAllocationUseCase,
  PauseGrowthCampaignUseCase,
  RejectGrowthCampaignUseCase,
  ResumeGrowthCampaignUseCase,
  ReverseAllocationUseCase,
} from '../application/Campaign.usecases.js';
import {
  AllocationIdParamsSchema,
  AllocationListQuerySchema,
  AllocationOverrideSchema,
  AllocationReverseSchema,
  AllocatePartnersSchema,
  CampaignIdParamsSchema,
  CancelGrowthCampaignSchema,
  CreateGrowthCampaignSchema,
  EndGrowthCampaignSchema,
  GrowCampaignQuerySchema,
  QueueQuerySchema,
  RejectGrowthCampaignSchema,
} from './Campaign.validator.js';

export const buildCampaignRouter = (deps = {}) => {
  const repo = deps.repo ?? new MongoCampaignRepository();
  const create = deps.create ?? new CreateGrowthCampaignUseCase({ repo, events: deps.events });
  const listMine = deps.listMine ?? new ListMyGrowthCampaignsUseCase({ repo });
  const getMine = deps.getMine ?? new GetMyGrowthCampaignUseCase({ repo });
  const cancel = deps.cancel ?? new CancelGrowthCampaignUseCase({ repo, events: deps.events });
  const pause = deps.pause ?? new PauseGrowthCampaignUseCase({ repo });
  const resume = deps.resume ?? new ResumeGrowthCampaignUseCase({ repo });
  const mine = deps.mine ?? new GetMyAllocationUseCase({ repo });
  const placed = deps.placed ?? new ListMyPlacedPartnersUseCase({ repo });
  const auth = deps.auth ?? requireAuth;
  const audit = deps.recordAudit ?? recordAudit;
  const auditCampaign = (req, campaignId, detail) => {
    void audit({
      actorId: req.auth?.partnerId,
      action: 'campaign.decide',
      targetType: 'campaign',
      targetId: String(campaignId),
      detail,
    });
  };

  const router = express.Router();
  router.use(auth);

  router.get('/', asyncHandler(async (req, res) => {
    const data = await listMine.execute(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.post('/', validate({ body: CreateGrowthCampaignSchema }), asyncHandler(async (req, res) => {
    const data = await create.execute(req.auth.partnerId, req.validated.body);
    return sendSuccess(res, {
      message: 'Campaign funded and submitted for review',
      data,
      statusCode: 201,
    });
  }));

  router.get('/me/allocation', asyncHandler(async (req, res) => {
    const data = await mine.execute(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.get('/me/placed-partners', asyncHandler(async (req, res) => {
    const data = await placed.execute(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.get('/:id', validate({ params: CampaignIdParamsSchema }), asyncHandler(async (req, res) => {
    const data = await getMine.execute(req.validated.params.id, req.auth.partnerId);
    return sendSuccess(res, { data });
  }));

  router.post(
    '/:id/cancel',
    validate({ params: CampaignIdParamsSchema, body: CancelGrowthCampaignSchema }),
    asyncHandler(async (req, res) => {
      const data = await cancel.execute(
        req.validated.params.id,
        req.auth.partnerId,
        req.validated.body.reason,
      );
      auditCampaign(req, data.id, { from: 'Pending', to: 'Cancelled', by: 'owner' });
      return sendSuccess(res, { message: 'Campaign cancelled and unspent budget returned', data });
    }),
  );

  router.post(
    '/:id/pause',
    validate({ params: CampaignIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await pause.execute(req.validated.params.id, req.auth.partnerId);
      auditCampaign(req, data.id, { from: 'Active', to: 'Paused', by: 'owner' });
      return sendSuccess(res, { message: 'Campaign paused', data });
    }),
  );

  router.post(
    '/:id/resume',
    validate({ params: CampaignIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await resume.execute(req.validated.params.id, req.auth.partnerId);
      auditCampaign(req, data.id, { from: 'Paused', to: 'Active', by: 'owner' });
      return sendSuccess(res, { message: 'Campaign resumed', data });
    }),
  );

  return router;
};

export const buildAdminCampaignRouter = (deps = {}) => {
  const repo = deps.repo ?? new MongoCampaignRepository();
  const list = deps.list ?? new ListAdminGrowthCampaignsUseCase({ repo });
  const activate = deps.activate ?? new ActivateGrowthCampaignUseCase({ repo, events: deps.events });
  const reject = deps.reject ?? new RejectGrowthCampaignUseCase({ repo, events: deps.events });
  const end = deps.end ?? new EndGrowthCampaignUseCase({ repo, events: deps.events });
  const pause = deps.pause ?? new PauseGrowthCampaignUseCase({ repo });
  const resume = deps.resume ?? new ResumeGrowthCampaignUseCase({ repo });
  const queue = deps.queue ?? new GetCampaignQueueUseCase({ repo });
  const attribution = deps.attribution ?? new GetCampaignAttributionUseCase({ repo });
  const allocate = deps.allocate ?? new AllocatePartnersUseCase({ repo, events: deps.events });
  const allocations = deps.allocations ?? new ListAdminAllocationsUseCase({ repo });
  const override = deps.override ?? new OverrideAllocationUseCase({ repo, events: deps.events });
  const reverse = deps.reverse ?? new ReverseAllocationUseCase({ repo, events: deps.events });
  const auth = deps.auth ?? requireAuth;
  const admin = deps.admin ?? requireRole('admin');
  const audit = deps.recordAudit ?? recordAudit;
  const auditCampaign = (req, campaignId, detail) => {
    void audit({
      actorId: req.auth?.partnerId,
      action: 'campaign.decide',
      targetType: 'campaign',
      targetId: String(campaignId),
      detail,
    });
  };

  const router = express.Router();
  router.use(auth, admin);

  router.get('/queue', validate({ query: QueueQuerySchema }), asyncHandler(async (req, res) => {
    const data = await queue.execute(req.validated.query);
    return sendSuccess(res, { data: data.data, meta: data.meta });
  }));

  router.get('/attribution', asyncHandler(async (req, res) => {
    const limit = Number(req.query?.limit ?? 100);
    const data = await attribution.execute({ limit });
    return sendSuccess(res, { data });
  }));

  router.post('/allocate', validate({ body: AllocatePartnersSchema }), asyncHandler(async (req, res) => {
    const result = await allocate.execute({
      campaignId: req.validated.body.campaignId ?? null,
      limit: req.validated.body.limit,
      actorId: req.auth.partnerId,
    });
    void audit({
      actorId: req.auth.partnerId,
      action: 'campaign.allocate',
      targetType: 'campaign',
      targetId: req.validated.body.campaignId ?? 'all',
      detail: {
        allocated: result.allocated.length,
        skipped: result.skipped,
        context: result.context,
      },
    });
    return sendSuccess(res, {
      message: `Allocated ${result.allocated.length} partner${result.allocated.length === 1 ? '' : 's'}`,
      data: result,
    });
  }));

  router.get('/allocations', validate({ query: AllocationListQuerySchema }), asyncHandler(async (req, res) => {
    const data = await allocations.execute(req.validated.query);
    return sendSuccess(res, { data });
  }));

  router.post('/allocations/override', validate({ body: AllocationOverrideSchema }), asyncHandler(async (req, res) => {
    const data = await override.execute({
      ...req.validated.body,
      actorId: req.auth.partnerId,
    });
    void audit({
      actorId: req.auth.partnerId,
      action: 'campaign.allocation.override',
      targetType: 'campaign',
      targetId: req.validated.body.campaignId,
      detail: {
        partnerId: req.validated.body.partnerId,
        reason: req.validated.body.reason,
        allocationId: data.allocation?.id,
      },
    });
    return sendSuccess(res, { message: 'Partner placed manually', data });
  }));

  router.post(
    '/allocations/:allocationId/reverse',
    validate({ params: AllocationIdParamsSchema, body: AllocationReverseSchema }),
    asyncHandler(async (req, res) => {
      const data = await reverse.execute({
        allocationId: req.validated.params.allocationId,
        actorId: req.auth.partnerId,
        reason: req.validated.body.reason,
      });
      void audit({
        actorId: req.auth.partnerId,
        action: 'campaign.allocation.reverse',
        targetType: 'campaign-allocation',
        targetId: req.validated.params.allocationId,
        detail: {
          reason: req.validated.body.reason,
          alreadyReversed: data.alreadyReversed === true,
        },
      });
      return sendSuccess(res, { message: 'Allocation reversed and partner returned to the queue', data });
    }),
  );

  router.get('/', validate({ query: GrowCampaignQuerySchema }), asyncHandler(async (req, res) => {
    const result = await list.execute(req.validated.query);
    return sendSuccess(res, { data: result.data, meta: result.meta });
  }));

  router.post(
    '/:id/activate',
    validate({ params: CampaignIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await activate.execute(req.validated.params.id, req.auth.partnerId);
      auditCampaign(req, data.id, { from: 'Pending', to: 'Active', by: 'admin' });
      return sendSuccess(res, { message: 'Campaign activated', data });
    }),
  );

  router.post(
    '/:id/reject',
    validate({ params: CampaignIdParamsSchema, body: RejectGrowthCampaignSchema }),
    asyncHandler(async (req, res) => {
      const data = await reject.execute(
        req.validated.params.id,
        req.auth.partnerId,
        req.validated.body.reason,
      );
      auditCampaign(req, data.id, { from: 'Pending', to: 'Cancelled', by: 'admin' });
      return sendSuccess(res, { message: 'Campaign rejected and budget returned', data });
    }),
  );

  router.post(
    '/:id/pause',
    validate({ params: CampaignIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await pause.execute(req.validated.params.id);
      auditCampaign(req, data.id, { from: 'Active', to: 'Paused', by: 'admin' });
      return sendSuccess(res, { message: 'Campaign paused', data });
    }),
  );

  router.post(
    '/:id/resume',
    validate({ params: CampaignIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const data = await resume.execute(req.validated.params.id);
      auditCampaign(req, data.id, { from: 'Paused', to: 'Active', by: 'admin' });
      return sendSuccess(res, { message: 'Campaign resumed', data });
    }),
  );

  router.post(
    '/:id/end',
    validate({ params: CampaignIdParamsSchema, body: EndGrowthCampaignSchema }),
    asyncHandler(async (req, res) => {
      const data = await end.execute(
        req.validated.params.id,
        req.auth.partnerId,
        req.validated.body.spentAmount,
        req.validated.body.note,
      );
      auditCampaign(req, data.id, {
        from: 'Active',
        to: 'Ended',
        by: 'admin',
        spent: req.validated.body.spentAmount,
      });
      return sendSuccess(res, { message: 'Campaign ended and unspent budget returned', data });
    }),
  );

  router.post(
    '/:id/allocate',
    validate({ params: CampaignIdParamsSchema, body: AllocatePartnersSchema.omit({ campaignId: true }) }),
    asyncHandler(async (req, res) => {
      const result = await allocate.execute({
        campaignId: req.validated.params.id,
        limit: req.validated.body.limit,
        actorId: req.auth.partnerId,
      });
      void audit({
        actorId: req.auth.partnerId,
        action: 'campaign.allocate',
        targetType: 'campaign',
        targetId: req.validated.params.id,
        detail: { allocated: result.allocated.length, skipped: result.skipped },
      });
      return sendSuccess(res, {
        message: `Allocated ${result.allocated.length} partner${result.allocated.length === 1 ? '' : 's'}`,
        data: result,
      });
    }),
  );

  return router;
};

export default buildCampaignRouter();
