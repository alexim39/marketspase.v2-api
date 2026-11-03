import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { GetActionsUseCase, GetActivationUseCase, GetBenchUseCase, GetFunnelUseCase, GetOrgFunnelUseCase, GetRetentionUseCase, GetTeamUseCase } from '../application/Analytics.usecases.js';
import { resolveSubject } from '../../network/application/SubjectScope.js';
import { GetFollowUpRemindersUseCase, GetStuckProspectsUseCase } from '../../crm/application/Prospect.queries.js';
import { GetMyProgressionUseCase } from '../../progression/application/Progression.usecases.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { MongoTeamSnapshotStore } from '../infrastructure/TeamSnapshots.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoOrderReader, MongoCommissionLedger } from '../../billing/infrastructure/Billing.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoGoalStore } from '../../goals/infrastructure/Goals.mongo.repository.js';
import { MongoNotificationStore } from '../../notifications/infrastructure/Notifications.mongo.repository.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { MongoEventStore } from '../../events/infrastructure/Events.mongo.repository.js';
import { GetNotificationFeedUseCase } from '../../notifications/application/Notifications.usecases.js';
import { ListGoalsUseCase } from '../../goals/application/Goals.usecases.js';
import { ProspectSurveyModel } from '../../../apps/survey/models/survey.model.js';
import { normalizeState } from '../../../shared/geo/nigerianStates.js';

const WindowQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).optional().default(30),
  // Per-member coaching read: omitted (or self) → own data; otherwise the
  // requester must be an admin or an upline of the subject (403 otherwise).
  subjectId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id').optional(),
});

const ActionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(15),
});

/** Manual wiring — use-case composition (feed + goals) over shared repos. */
export const buildAnalyticsRouter = (deps = {}) => {
  const prospects = deps.prospects ?? new MongoProspectRepository();
  const orders = deps.orders ?? new MongoOrderReader();
  const network = deps.network ?? new MongoNetworkRepository();

  // Composed collaborators reuse their own slices' wiring.
  const ledger = deps.ledger ?? new MongoCommissionLedger();
  const reads = deps.reads ?? new MongoNotificationStore();
  const goalStore = deps.goalStore ?? new MongoGoalStore();
  const feed = deps.feed ?? new GetNotificationFeedUseCase({ prospects, ledger, reads });
  const goals = deps.goals ?? new ListGoalsUseCase({ goals: goalStore, orders, prospects, network });
  const stuck = deps.stuck ?? new GetStuckProspectsUseCase({ prospects });
  const reminders = deps.reminders ?? new GetFollowUpRemindersUseCase({ prospects });
  const progressStore = deps.progressStore ?? new MongoProgressionStore();
  const progression = deps.progression ?? new GetMyProgressionUseCase({ progress: progressStore, network, orders });
  const funnel = new GetFunnelUseCase({ prospects });
  const snapshots = deps.snapshots ?? new MongoTeamSnapshotStore();
  const team = new GetTeamUseCase({ orders, network, prospects, snapshots, goalProgress: (pid) => goals.execute({ partnerId: pid }) });
  const eventStore = deps.eventStore ?? new MongoEventStore();
  const partners = deps.partners ?? new MongoPartnerRepository();
  // Recruitment-opportunity count: pool rows in the member's normalized
  // state (bounded, cheap). Null-safe — actions skip the card when unknown.
  const poolCount = deps.poolCount ?? (async (partnerId) => {
    try {
      const me = await partners.findById(partnerId).catch(() => null);
      const want = normalizeState(me?.address?.state);
      if (!want) return 0;
      return ProspectSurveyModel.countDocuments({ username: 'business', stateNorm: want }).catch(() => 0);
    } catch {
      return 0;
    }
  });
  const actions = new GetActionsUseCase({ feed, goals, prospects, stuck, progression, events: eventStore, poolCount, reminders });
  const orgFunnel = deps.orgFunnel ?? new GetOrgFunnelUseCase({ prospects });
  const retention = deps.retention ?? new GetRetentionUseCase({ partners, progress: progressStore });
  const activation = new GetActivationUseCase({ partners, prospects, progress: progressStore, network });
  const bench = new GetBenchUseCase({ progress: progressStore, network });

  const router = express.Router();
  router.use(requireAuth);

  router.get('/funnel', validate({ query: WindowQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await funnel.execute({ partnerId: req.auth?.partnerId, days: q?.days });
    res.status(200).json({ message: 'Funnel retrieved successfully', data, success: true });
  }));

  router.get('/team', validate({ query: WindowQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const subject = await resolveSubject({
      requesterId: req.auth?.partnerId, subjectId: q?.subjectId, network, partners,
    });
    const data = await team.execute({ partnerId: subject, days: q?.days });
    res.status(200).json({ message: 'Team analytics retrieved successfully', data, success: true });
  }));

  router.get('/actions', validate({ query: ActionsQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await actions.execute({ partnerId: req.auth?.partnerId, limit: q?.limit });
    res.status(200).json({ message: 'Daily actions retrieved successfully', data, success: true });
  }));

  router.get('/activation', validate({ query: WindowQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await activation.execute({ partnerId: req.auth?.partnerId, days: q?.days });
    res.status(200).json({ message: 'Activation analytics retrieved successfully', data, success: true });
  }));

  router.get('/bench', asyncHandler(async (req, res) => {
    const data = await bench.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Leadership bench retrieved successfully', data, success: true });
  }));

  router.get('/admin/funnel', requireRole('admin'), validate({ query: WindowQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await orgFunnel.execute({ days: q?.days });
    res.status(200).json({ message: 'Organization funnel retrieved successfully', data, success: true });
  }));

  const RetentionQuery = z.object({
    months: z.coerce.number().int().min(2).max(12).optional().default(6),
  });

  router.get('/admin/retention', requireRole('admin'), validate({ query: RetentionQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await retention.execute({ months: q?.months });
    res.status(200).json({ message: 'Cohort retention retrieved successfully', data, success: true });
  }));

  return router;
};

export default buildAnalyticsRouter();
