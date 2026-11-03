import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  ListDownlineUseCase, ListMyReportsUseCase, ListRequestsUseCase,
  ListTeamReportsUseCase, RequestReportUseCase, SubmitReportUseCase,
} from '../application/Reports.usecases.js';
import { MongoReportStore } from '../infrastructure/Reports.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const isoDate = z.coerce.date();
const periodFields = { periodStart: isoDate, periodEnd: isoDate };

const ReportSchema = z.object({
  title: z.string().trim().min(2).max(120),
  ...periodFields,
  highlights: z.string().trim().min(1).max(5000),
  blockers: z.string().trim().max(2000).optional().default(''),
  plans: z.string().trim().max(2000).optional().default(''),
  requestId: objectId.optional(),
}).refine((r) => new Date(r.periodEnd) > new Date(r.periodStart), {
  message: 'Period end must be after period start',
  path: ['periodEnd'],
});

const RequestSchema = z.object({
  downlineId: objectId,
  ...periodFields,
  note: z.string().trim().max(500).optional().default(''),
}).refine((r) => new Date(r.periodEnd) > new Date(r.periodStart), {
  message: 'Period end must be after period start',
  path: ['periodEnd'],
});

const BoxQuery = z.object({ box: z.enum(['incoming', 'outgoing']).optional().default('incoming') });
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).optional().default(20) });

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildReportsRouter = (deps = {}) => {
  const reports = deps.reports ?? new MongoReportStore();
  const network = deps.network ?? new MongoNetworkRepository();

  const submit = new SubmitReportUseCase({ reports, network });
  const mine = new ListMyReportsUseCase({ reports });
  const request = new RequestReportUseCase({ reports, network });
  const boxes = new ListRequestsUseCase({ reports });
  const team = new ListTeamReportsUseCase({ reports, network });
  const downline = new ListDownlineUseCase({ network });

  const router = express.Router();
  router.use(requireAuth);

  router.post('/', validate({ body: ReportSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await submit.execute({ partnerId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: 'Report submitted successfully', data, success: true });
  }));

  router.get('/mine', validate({ query: LimitQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await mine.execute({ partnerId: req.auth?.partnerId, limit: q?.limit });
    res.status(200).json({ message: 'Reports retrieved successfully', data, success: true });
  }));

  router.post('/requests', validate({ body: RequestSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await request.execute({ requesterId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: 'Report requested successfully', data, success: true });
  }));

  router.get('/requests', validate({ query: BoxQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await boxes.execute({ partnerId: req.auth?.partnerId, box: q?.box });
    res.status(200).json({ message: 'Report requests retrieved successfully', data, success: true });
  }));

  router.get('/team', validate({ query: LimitQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await team.execute({ partnerId: req.auth?.partnerId, limit: q?.limit });
    res.status(200).json({ message: 'Team reports retrieved successfully', data, success: true });
  }));

  router.get('/downline', asyncHandler(async (req, res) => {
    const data = await downline.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Downline retrieved successfully', data, success: true });
  }));

  return router;
};

export default buildReportsRouter();
