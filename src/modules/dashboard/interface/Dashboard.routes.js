import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { GetOverviewUseCase, resolveOverviewTarget } from '../application/Dashboard.usecases.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoOrderReader, MongoCommissionLedger } from '../../billing/infrastructure/Billing.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoGoalStore } from '../../goals/infrastructure/Goals.mongo.repository.js';
import { MongoNotificationStore } from '../../notifications/infrastructure/Notifications.mongo.repository.js';
import { GetNotificationFeedUseCase } from '../../notifications/application/Notifications.usecases.js';
import { MongoTeamSnapshotStore } from '../../analytics/infrastructure/TeamSnapshots.mongo.repository.js';
import { ListGoalsUseCase } from '../../goals/application/Goals.usecases.js';
import { GetActionsUseCase, GetFunnelUseCase, GetTeamUseCase } from '../../analytics/application/Analytics.usecases.js';
import { GetFollowUpRemindersUseCase, GetStuckProspectsUseCase } from '../../crm/application/Prospect.queries.js';
import { MongoEventStore } from '../../events/infrastructure/Events.mongo.repository.js';
import { GetMyProgressionUseCase } from '../../progression/application/Progression.usecases.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
const OverviewQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).optional().default(30),
  // Optional upline-scoped read: leader views a downline partner's overview.
  for: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id').optional(),
});

/** Manual wiring — same composition graph as the analytics slice. */
export const buildDashboardRouter = (deps = {}) => {
  const prospects = deps.prospects ?? new MongoProspectRepository();
  const orders = deps.orders ?? new MongoOrderReader();
  const network = deps.network ?? new MongoNetworkRepository();
  const ledger = deps.ledger ?? new MongoCommissionLedger();
  const reads = deps.reads ?? new MongoNotificationStore();
  const goalStore = deps.goalStore ?? new MongoGoalStore();

  const feed = deps.feed ?? new GetNotificationFeedUseCase({ prospects, ledger, reads });
  const goals = deps.goals ?? new ListGoalsUseCase({ goals: goalStore, orders, prospects, network });
  const stuck = deps.stuck ?? new GetStuckProspectsUseCase({ prospects });
  const reminders = deps.reminders ?? new GetFollowUpRemindersUseCase({ prospects });
  const progressStore = deps.progressStore ?? new MongoProgressionStore();
  const progression = deps.progression ?? new GetMyProgressionUseCase({ progress: progressStore, network, orders });
  const eventStore = deps.eventStore ?? new MongoEventStore();
  const actions = deps.actions ?? new GetActionsUseCase({ feed, goals, prospects, stuck, progression, events: eventStore, reminders });
  const funnel = deps.funnel ?? new GetFunnelUseCase({ prospects });
  const snapshots = deps.snapshots ?? new MongoTeamSnapshotStore();
  const team = deps.team ?? new GetTeamUseCase({
    orders, network, prospects, snapshots, goalProgress: (pid) => goals.execute({ partnerId: pid }),
  });
  const overview = new GetOverviewUseCase({ actions, funnel, team, goals, feed });

  const router = express.Router();
  router.use(requireAuth);

  router.get('/overview', validate({ query: OverviewQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const targetId = await resolveOverviewTarget({
      requesterId: req.auth?.partnerId,
      forId: q?.for,
      network,
    });
    const data = await overview.execute({ partnerId: targetId, days: q?.days });
    res.status(200).json({ message: 'Dashboard overview retrieved successfully', data, success: true });
  }));

  return router;
};

export default buildDashboardRouter();
