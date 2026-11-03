import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { GOAL_KINDS } from '../domain/Goal.entity.js';
import {
  CelebrateGoalUseCase, CreateGoalUseCase, DeleteGoalUseCase, GetTrendsUseCase, ListGoalsUseCase, UpdateGoalUseCase,
} from '../application/Goals.usecases.js';
import { MongoGoalStore } from '../infrastructure/Goals.mongo.repository.js';
import { MongoOrderReader } from '../../billing/infrastructure/Billing.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { RecognitionUseCases } from '../../community/application/Community.usecases.js';
import { MongoCommunityStore } from '../../community/infrastructure/Community.mongo.repository.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';
import { resolveSubject } from '../../network/application/SubjectScope.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const GoalIdParam = z.object({ goalId: objectId });
const isoDate = z.coerce.date();

const GoalFields = {
  title: z.string().trim().max(120).optional().default(''),
  kind: z.enum(GOAL_KINDS),
  target: z.coerce.number().positive().max(1000000000),
  startDate: isoDate,
  endDate: isoDate,
  status: z.enum(['active', 'closed']).optional().default('active'),
  closedAt: isoDate.optional(),
};

const GoalSchema = z.object(GoalFields).refine((g) => new Date(g.endDate) > new Date(g.startDate), {
  message: 'End date must be after start date',
  path: ['endDate'],
});

// Zod v4 forbids .partial() on refined schemas — refine the partial instead.
const UpdateGoalSchema = z.object(
  Object.fromEntries(Object.entries(GoalFields).map(([k, s]) => [k, s.optional()])),
).refine(
  (g) => g.startDate === undefined || g.endDate === undefined || new Date(g.endDate) > new Date(g.startDate),
  { message: 'End date must be after start date', path: ['endDate'] },
);
const TrendsQuery = z.object({
  months: z.coerce.number().int().min(2).max(12).optional().default(6),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildGoalsRouter = (deps = {}) => {
  const goals = deps.goals ?? new MongoGoalStore();
  const orders = deps.orders ?? new MongoOrderReader();
  const prospects = deps.prospects ?? new MongoProspectRepository();
  const network = deps.network ?? new MongoNetworkRepository();

  const create = new CreateGoalUseCase({ goals });
  const list = new ListGoalsUseCase({ goals, orders, prospects, network });
  const update = new UpdateGoalUseCase({ goals });
  const remove = new DeleteGoalUseCase({ goals });
  const trends = new GetTrendsUseCase({ orders });
  const community = deps.community ?? new MongoCommunityStore();
  const celebrate = deps.celebrate ?? new CelebrateGoalUseCase({
    goals, orders, prospects, network, community,
    recognition: deps.recognition ?? new RecognitionUseCases({ community }),
  });

  const router = express.Router();
  // Session identity owns every goal — no :partnerId to tamper with.
  router.use(requireAuth);

  router.get('/mine', asyncHandler(async (req, res) => {
    const data = await list.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Goals retrieved successfully', data, success: true });
  }));

  // Per-member coaching read: own, upline or admin (outsiders get 403).
  router.get('/by-partner/:partnerId', validate({ params: z.object({ partnerId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const subject = await resolveSubject({
      requesterId: req.auth?.partnerId, subjectId: params.partnerId,
      network, partners: new MongoPartnerRepository(),
    });
    const data = await list.execute({ partnerId: subject });
    res.status(200).json({ message: 'Goals retrieved successfully', data, success: true });
  }));

  router.get('/trends', validate({ query: TrendsQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await trends.execute({ partnerId: req.auth?.partnerId, months: q?.months });
    res.status(200).json({ message: 'Trends retrieved successfully', data, success: true });
  }));

  router.post('/', validate({ body: GoalSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await create.execute({ partnerId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: 'Goal created successfully', data, success: true });
  }));

  router.put('/:goalId', validate({ params: GoalIdParam, body: UpdateGoalSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await update.execute({ requesterId: req.auth?.partnerId, goalId: params.goalId, ...body });
    res.status(200).json({ message: 'Goal updated successfully', data, success: true });
  }));

  router.delete('/:goalId', validate({ params: GoalIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    await remove.execute({ requesterId: req.auth?.partnerId, goalId: params.goalId });
    res.status(200).json({ message: 'Goal deleted successfully', success: true });
  }));

  router.post('/:goalId/celebrate', validate({ params: GoalIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await celebrate.execute({ requesterId: req.auth?.partnerId, goalId: params.goalId });
    res.status(200).json({ message: data?.duplicate ? 'Goal already celebrated' : 'Goal celebrated in the community', data, success: true });
  }));

  return router;
};

export default buildGoalsRouter();
