import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  ExportCommissionsUseCase, ExportCommunityUseCase, ExportPipelineUseCase, ExportReportsUseCase, ExportTeamUseCase,
} from '../application/Exports.usecases.js';
import { toCsv } from '../domain/Export.csv.js';
import { buildXlsx } from '../domain/Export.xlsx.js';
import { CommunityAnalyticsUseCase } from '../../community/application/Community.usecases.js';
import { MongoCommunityStore } from '../../community/infrastructure/Community.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoCommissionLedger } from '../../billing/infrastructure/Billing.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoReportStore } from '../../reports/infrastructure/Reports.mongo.repository.js';

const LimitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});
const ReportsQuery = LimitQuery.extend({
  scope: z.enum(['mine', 'team']).optional().default('mine'),
});
const DaysQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional().default(7),
});

/** UTF-8 BOM so Excel opens the file correctly. */
const sendCsv = (res, { name, columns, rows }) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.status(200).send(`\uFEFF${toCsv(columns, rows)}`);
};

const sendXlsx = async (res, sheet, { name, columns, rows }) => {
  const buffer = await buildXlsx(sheet, columns, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  res.status(200).send(buffer);
};

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildExportsRouter = (deps = {}) => {
  const prospects = deps.prospects ?? new MongoProspectRepository();
  const ledger = deps.ledger ?? new MongoCommissionLedger();
  const network = deps.network ?? new MongoNetworkRepository();
  const reports = deps.reports ?? new MongoReportStore();
  const community = deps.community ?? new MongoCommunityStore();

  const team = new ExportTeamUseCase({ network });
  const pipeline = new ExportPipelineUseCase({ prospects });
  const commissions = new ExportCommissionsUseCase({ ledger });
  const periodReports = new ExportReportsUseCase({ reports, network });
  const communityStats = deps.communityStats ?? new ExportCommunityUseCase({
    analytics: deps.analytics ?? new CommunityAnalyticsUseCase({ community }),
  });

  const router = express.Router();
  // Session identity scopes every export — no :partnerId to tamper with.
  router.use(requireAuth);

  router.get('/team.csv', asyncHandler(async (req, res) => {
    sendCsv(res, await team.execute({ partnerId: req.auth?.partnerId }));
  }));

  router.get('/team.xlsx', asyncHandler(async (req, res) => {
    await sendXlsx(res, 'Team', await team.execute({ partnerId: req.auth?.partnerId }));
  }));

  router.get('/pipeline.csv', validate({ query: LimitQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    sendCsv(res, await pipeline.execute({ partnerId: req.auth?.partnerId, limit: q?.limit }));
  }));

  router.get('/pipeline.xlsx', validate({ query: LimitQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    await sendXlsx(res, 'Pipeline', await pipeline.execute({ partnerId: req.auth?.partnerId, limit: q?.limit }));
  }));

  router.get('/commissions.csv', validate({ query: LimitQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    sendCsv(res, await commissions.execute({ partnerId: req.auth?.partnerId, limit: q?.limit }));
  }));

  router.get('/commissions.xlsx', validate({ query: LimitQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    await sendXlsx(res, 'Commissions', await commissions.execute({ partnerId: req.auth?.partnerId, limit: q?.limit }));
  }));

  router.get('/reports.csv', validate({ query: ReportsQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    sendCsv(res, await periodReports.execute({ partnerId: req.auth?.partnerId, scope: q?.scope }));
  }));

  router.get('/reports.xlsx', validate({ query: ReportsQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    await sendXlsx(res, 'Reports', await periodReports.execute({ partnerId: req.auth?.partnerId, scope: q?.scope }));
  }));

  router.get('/community.csv', validate({ query: DaysQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    sendCsv(res, await communityStats.execute({ days: q?.days }));
  }));

  router.get('/community.xlsx', validate({ query: DaysQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    await sendXlsx(res, 'Community', await communityStats.execute({ days: q?.days }));
  }));

  return router;
};

export default buildExportsRouter();
