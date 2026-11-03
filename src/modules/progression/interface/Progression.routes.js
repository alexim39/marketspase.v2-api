import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  DecideNominationUseCase, DecideTrainingConfirmUseCase, GetConfirmationStatsUseCase, GetMyProgressionUseCase,
  GetOversightUseCase, ListPendingConfirmationsUseCase, ListPendingNominationsUseCase, RequestNominationUseCase,
  RequestTrainingConfirmUseCase, TeamDistributionUseCase, UpdateMilestonesUseCase,
} from '../application/Progression.usecases.js';
import { MongoProgressionStore } from '../infrastructure/Progression.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoOrderReader } from '../../billing/infrastructure/Billing.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoEventStore } from '../../events/infrastructure/Events.mongo.repository.js';
import { MongoReportStore } from '../../reports/infrastructure/Reports.mongo.repository.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';
import { resolveSubject } from '../../network/application/SubjectScope.js';
import { RecognitionUseCases } from '../../community/application/Community.usecases.js';
import { MongoCommunityStore } from '../../community/infrastructure/Community.mongo.repository.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const stamp = z.object({ done: z.boolean() }).passthrough();

const accountsSchema = z.union([
  z.object({
    count: z.number().int().min(0).max(1000),
    refs: z.array(z.string().max(100)).max(10).optional(),
    maintenanceRef: z.string().max(100).optional(),
    maintenanceMonth: z.string().max(7).optional(),
  }).passthrough(),
  z.number().int().min(0).max(1000),
]);
const maintenanceSchema = z.union([
  z.object({
    done: z.boolean().optional(),
    ref: z.string().max(100).optional(),
    month: z.string().max(7).optional(),
  }).passthrough(),
  z.boolean(),
]);

const MilestonesSchema = z.object({
  ipo: stamp.optional(),
  qsg: stamp.optional(),
  smo: stamp.optional(),
  accounts: accountsSchema.optional(),
  maintenance: maintenanceSchema.optional(),
  fullTime: stamp.optional(),
  office: stamp.optional(),
  officeAddress: z.string().max(200).optional(),
  g8Request: z.union([z.object({ status: z.enum(['none', 'submitted', 'approved']) }).passthrough(), z.enum(['none', 'submitted', 'approved'])]).optional(),
  onboardingSession: stamp.optional(),
  qualifiedConfirmed: stamp.optional(),
  appointment: stamp.optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });

const NominationSchema = z.object({ note: z.string().trim().max(500).optional().default('') });
const DecisionSchema = z.object({ partnerId: objectId, approved: z.boolean() });
const TrainingRequestSchema = z.object({ key: z.enum(['ipo', 'qsg', 'smo', 'fullTime', 'office', 'onboardingSession', 'accounts', 'maintenance']) });
const TrainingDecisionSchema = z.object({
  partnerId: objectId,
  key: z.enum(['ipo', 'qsg', 'smo', 'fullTime', 'office', 'onboardingSession', 'accounts', 'maintenance']),
  approved: z.boolean(),
  note: z.string().trim().max(500).optional().default(''),
}).refine((b) => b.approved === true || b.note.length > 0, {
  message: 'A reason is required when declining',
  path: ['note'],
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildProgressionRouter = (deps = {}) => {
  const progress = deps.progress ?? new MongoProgressionStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const orders = deps.orders ?? new MongoOrderReader();

  const community = deps.community ?? new MongoCommunityStore();
  const mine = deps.mine ?? new GetMyProgressionUseCase({
    progress,
    network,
    orders,
    recognition: deps.recognition ?? new RecognitionUseCases({ community }),
    prospects: deps.prospects ?? new MongoProspectRepository(),
    community,
    eventStore: deps.eventStore ?? new MongoEventStore(),
    reports: deps.reports ?? new MongoReportStore(),
  });
  const update = deps.update ?? new UpdateMilestonesUseCase({ progress, network });
  const nominate = new RequestNominationUseCase({ progress, network, orders, mine });
  const requestTraining = new RequestTrainingConfirmUseCase({ progress, network });
  const decideTraining = new DecideTrainingConfirmUseCase({ progress, network });
  const pendingConfirmations = new ListPendingConfirmationsUseCase({ progress, network });
  const confirmationStats = new GetConfirmationStatsUseCase({ progress, network });
  const decide = new DecideNominationUseCase({ progress, network, orders, mine });
  const team = new TeamDistributionUseCase({ progress, network });
  const partners = deps.partners ?? new MongoPartnerRepository();
  const pending = deps.pending ?? new ListPendingNominationsUseCase({ progress, network });
  const oversight = deps.oversight ?? new GetOversightUseCase({
    mine, partners,
    distribution: deps.distribution ?? team,
    pending,
  });

  const router = express.Router();
  router.use(requireAuth);

  router.get('/mine', asyncHandler(async (req, res) => {
    const data = await mine.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Progression retrieved successfully', data, success: true });
  }));

  // Coaching read: own, upline or admin (outsiders get 403). Read-only —
  // viewing a member never promotes them or posts recognition.
  router.get('/by-member/:partnerId', validate({ params: z.object({ partnerId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const subject = await resolveSubject({
      requesterId: req.auth?.partnerId, subjectId: params.partnerId,
      network, partners,
    });
    const data = await mine.execute({ partnerId: subject, readOnly: true });
    res.status(200).json({ message: 'Progression retrieved successfully', data, success: true });
  }));

  router.put('/mine/milestones', validate({ body: MilestonesSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await update.execute({ partnerId: req.auth?.partnerId, patch: body });
    res.status(200).json({ message: 'Milestones updated successfully', data, success: true });
  }));

  router.post('/mine/nomination', validate({ body: NominationSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await nominate.execute({ partnerId: req.auth?.partnerId, note: body?.note });
    res.status(200).json({ message: 'Nomination requested successfully', data, success: true });
  }));

  router.post('/nominations/decision', validate({ body: DecisionSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await decide.execute({ approverId: req.auth?.partnerId, partnerId: body.partnerId, approved: body.approved });
    res.status(200).json({ message: 'Nomination decided successfully', data, success: true });
  }));

  router.post('/mine/training/request', validate({ body: TrainingRequestSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await requestTraining.execute({ partnerId: req.auth?.partnerId, key: body.key });
    res.status(200).json({ message: 'Training sent for upline confirmation', data, success: true });
  }));

  router.get('/team/confirmations', asyncHandler(async (req, res) => {
    const data = await pendingConfirmations.execute({ requesterId: req.auth?.partnerId });
    res.status(200).json({ message: 'Pending training confirmations retrieved successfully', data, success: true });
  }));

  router.get('/team/confirmation-stats', asyncHandler(async (req, res) => {
    const data = await confirmationStats.execute({ requesterId: req.auth?.partnerId });
    res.status(200).json({ message: 'Confirmation responsiveness retrieved successfully', data, success: true });
  }));

  router.post('/confirmations/decision', validate({ body: TrainingDecisionSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await decideTraining.execute({
      approverId: req.auth?.partnerId,
      partnerId: body.partnerId,
      key: body.key,
      approved: body.approved,
      note: body.note,
    });
    res.status(200).json({ message: body.approved ? 'Training confirmed successfully' : 'Training declined', data, success: true });
  }));

  router.get('/team/distribution', asyncHandler(async (req, res) => {
    const data = await team.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Team distribution retrieved successfully', data, success: true });
  }));

  router.get('/nominations/pending', asyncHandler(async (req, res) => {
    const data = await pending.execute({ requesterId: req.auth?.partnerId });
    res.status(200).json({ message: 'Pending nominations retrieved successfully', data, success: true });
  }));

  router.get('/oversight', asyncHandler(async (req, res) => {
    const data = await oversight.execute({ requesterId: req.auth?.partnerId });
    res.status(200).json({ message: 'Oversight retrieved successfully', data, success: true });
  }));

  return router;
};

export default buildProgressionRouter();
