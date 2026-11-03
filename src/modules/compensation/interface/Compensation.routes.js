import express from 'express';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { recordAudit } from '../../audit/index.js';
import { planSummary } from '../domain/Compensation.plan.js';
import { MongoCompensationRepository } from '../infrastructure/Compensation.mongo.repository.js';
import {
  GetMyCompensationUseCase,
  ListAdminCommissionEntriesUseCase,
  ListAdminMentorBonusesUseCase,
  ReleaseCommissionUseCase,
  RunMentorBonusesUseCase,
  SetCommissionRankUseCase,
  VoidCommissionUseCase,
} from '../application/Compensation.usecases.js';
import {
  CompensationEntryQuerySchema,
  EntryParamsSchema,
  MentorBonusQuerySchema,
  SetCommissionRankSchema,
  VoidCommissionSchema,
} from './Compensation.validator.js';

export const buildCompensationRouter = (deps = {}) => {
  const repo = deps.repo ?? new MongoCompensationRepository();
  const mine = deps.mine ?? new GetMyCompensationUseCase({ repo });
  const auth = deps.auth ?? requireAuth;

  const router = express.Router();
  router.use(auth);
  router.get('/plan', (_req, res) => sendSuccess(res, { data: planSummary() }));
  router.get('/me', asyncHandler(async (req, res) => {
    const data = await mine.execute(req.auth.partnerId);
    return sendSuccess(res, { data });
  }));
  return router;
};

export const buildAdminCompensationRouter = (deps = {}) => {
  const repo = deps.repo ?? new MongoCompensationRepository();
  const listEntries = deps.listEntries ?? new ListAdminCommissionEntriesUseCase({ repo });
  const release = deps.release ?? new ReleaseCommissionUseCase({ repo });
  const voidEntry = deps.voidEntry ?? new VoidCommissionUseCase({ repo });
  const listBonuses = deps.listBonuses ?? new ListAdminMentorBonusesUseCase({ repo });
  const runBonuses = deps.runBonuses ?? new RunMentorBonusesUseCase({ repo });
  const setRank = deps.setRank ?? new SetCommissionRankUseCase({ repo });
  const auth = deps.auth ?? requireAuth;
  const admin = deps.admin ?? requireRole('admin');
  const audit = deps.recordAudit ?? recordAudit;

  const router = express.Router();
  router.use(auth, admin);

  router.get('/entries', validate({ query: CompensationEntryQuerySchema }), asyncHandler(async (req, res) => {
    const result = await listEntries.execute(req.validated.query);
    return sendSuccess(res, { data: result.data, meta: result.meta });
  }));

  router.post('/entries/:id/release', validate({ params: EntryParamsSchema }), asyncHandler(async (req, res) => {
    const result = await release.execute(req.validated.params.id, req.auth.partnerId);
    void audit({
      actorId: req.auth.partnerId,
      action: 'commission.release',
      targetType: 'commission',
      targetId: req.validated.params.id,
      detail: { amount: result.entry?.amount ?? 0, repeated: result.repeated },
    });
    return sendSuccess(res, {
      message: result.repeated ? 'Commission already released' : 'Commission released',
      data: result,
    });
  }));

  router.post(
    '/entries/:id/void',
    validate({ params: EntryParamsSchema, body: VoidCommissionSchema }),
    asyncHandler(async (req, res) => {
      const result = await voidEntry.execute(
        req.validated.params.id,
        req.auth.partnerId,
        req.validated.body.reason,
      );
      void audit({
        actorId: req.auth.partnerId,
        action: 'commission.void',
        targetType: 'commission',
        targetId: req.validated.params.id,
        detail: { reason: req.validated.body.reason, repeated: result.repeated },
      });
      return sendSuccess(res, {
        message: result.repeated ? 'Commission already voided' : 'Commission voided',
        data: result,
      });
    }),
  );

  router.get('/mentor-bonuses', validate({ query: MentorBonusQuerySchema }), asyncHandler(async (req, res) => {
    const result = await listBonuses.execute(req.validated.query);
    return sendSuccess(res, { data: result.data, meta: result.meta });
  }));

  router.post('/mentor-bonuses/run', asyncHandler(async (req, res) => {
    const data = await runBonuses.execute(new Date());
    void audit({
      actorId: req.auth.partnerId,
      action: 'mentor-bonus.run',
      targetType: 'mentor-bonus',
      targetId: 'batch',
      detail: data,
    });
    return sendSuccess(res, { message: 'Mentor bonus run complete', data });
  }));

  router.patch('/partners/rank', validate({ body: SetCommissionRankSchema }), asyncHandler(async (req, res) => {
    const data = await setRank.execute(req.validated.body.identifier, req.validated.body.rank);
    void audit({
      actorId: req.auth.partnerId,
      action: 'commission.rank.set',
      targetType: 'partner',
      targetId: data.id,
      detail: { rank: data.commissionRank },
    });
    return sendSuccess(res, { message: `Commission rank set to ${data.commissionRank}`, data });
  }));

  return router;
};

export default buildCompensationRouter();
