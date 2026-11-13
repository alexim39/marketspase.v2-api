import { ValidationException } from '../../../shared/domain/AppError.js';
import { FeatureEventStore } from '../infrastructure/FeatureEvents.mongo.repository.js';
import { OraActionModel } from '../../ora/infrastructure/Ora.mongo.repository.js';
import { StoreCustomerLeadModel } from '../../stores/infrastructure/Store.models.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import { GrowthCommissionModel } from '../../compensation/infrastructure/Compensation.models.js';
import { MentorCheckinRepository } from '../../crm/infrastructure/MentorCheckin.model.js';

const EVENT_LIMIT = 50;
const clampDays = (days) => Math.min(Math.max(Number(days) || 30, 7), 180);

const countMap = (rows, key = 'event') =>
  Object.fromEntries((rows ?? []).map((row) => [String(row[key]), Number(row.count) || 0]));

const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export class RecordFeatureEventsUseCase {
  constructor({ events = new FeatureEventStore() } = {}) {
    this.events = events;
  }

  async execute({ partnerId, rows = [] }) {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > EVENT_LIMIT) {
      throw new ValidationException(`Send between 1 and ${EVENT_LIMIT} events`);
    }
    const clean = rows
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({
        event: String(row.event ?? '').trim(),
        feature: String(row.feature ?? '').trim(),
        meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
      }))
      .filter((row) => /^[a-z0-9_.:-]{2,80}$/i.test(row.event));
    if (clean.length === 0) throw new ValidationException('No valid event names supplied');
    return this.events.recordMany(partnerId, clean);
  }
}

export class GetFeatureAdoptionUseCase {
  constructor({
    events = new FeatureEventStore(),
    oraActions = OraActionModel,
    customerLeads = StoreCustomerLeadModel,
    partners = PartnersModel,
    commissions = GrowthCommissionModel,
    checkins = new MentorCheckinRepository(),
  } = {}) {
    Object.assign(this, { events, oraActions, customerLeads, partners, commissions, checkins });
  }

  async execute({ days = 30, now = new Date() } = {}) {
    const windowDays = clampDays(days);
    const since = new Date(new Date(now).getTime() - windowDays * 86400000);
    const dormantBefore = new Date(new Date(now).getTime() - 60 * 86400000);

    const [byEvent, byFeature, total, oraRows, leadRows, mentor, commissionLifecycle] = await Promise.all([
      this.events.byEventSince(since).catch(() => []),
      this.events.byFeatureSince(since).catch(() => []),
      this.events.totalSince(since).catch(() => ({ count: 0, partners: 0 })),
      this.oraActions.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
      ]).catch(() => []),
      this.customerLeads.aggregate([
        { $match: { firstSeenAt: { $lte: now } } },
        {
          $group: {
            _id: null,
            customers: { $sum: 1 },
            repeatCustomers: { $sum: { $cond: [{ $gte: ['$paidOrders', 2] }, 1, 0] } },
            dormant: {
              $sum: {
                $cond: [
                  { $and: [{ $gte: ['$paidOrders', 1] }, { $lte: ['$lastPaidAt', dormantBefore] }] },
                  1,
                  0,
                ],
              },
            },
            outreach: { $sum: { $cond: [{ $gte: ['$lastOutreachAt', since] }, 1, 0] } },
            convertedAfterOutreach: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$lastOutreachAt', null] },
                      { $gt: ['$lastPaidAt', '$lastOutreachAt'] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            revenueKobo: { $sum: '$totalSpentKobo' },
          },
        },
      ]).catch(() => []),
      this.checkins.statsSince(since).catch(() => ({ count: 0, mentors: 0 })),
      this.firstCommissionMetrics(since).catch(() => ({ sample: 0, medianDays: null, p90Days: null })),
    ]);

    const eventCounts = countMap(byEvent);
    const featureCounts = countMap(byFeature, 'feature');
    const ora = {};
    for (const row of oraRows ?? []) {
      const type = String(row?._id?.type ?? '');
      const status = String(row?._id?.status ?? '');
      ora[`${type}:${status}`] = Number(row.count) || 0;
    }
    const oraType = (type) => ['proposed', 'executed', 'skipped', 'failed'].reduce(
      (acc, status) => ({ ...acc, [status]: ora[`${type}:${status}`] ?? 0 }),
      {},
    );
    const lead = leadRows?.[0] ?? {};
    const customers = Number(lead.customers ?? 0);
    const repeatCustomers = Number(lead.repeatCustomers ?? 0);
    const outreach = Number(lead.outreach ?? 0);
    const convertedAfterOutreach = Number(lead.convertedAfterOutreach ?? 0);

    return {
      days: windowDays,
      generatedAt: new Date().toISOString(),
      events: {
        total: total.count,
        partners: total.partners,
        byEvent,
        byFeature,
      },
      launch: {
        views: eventCounts['launch_path_view'] ?? 0,
        completions: eventCounts['launch_path_completed'] ?? 0,
        nextActions: eventCounts['launch_path_next_action'] ?? 0,
        completionRate: rate(eventCounts['launch_path_completed'] ?? 0, eventCounts['launch_path_view'] ?? 0),
        timeToFirstCommission: commissionLifecycle,
      },
      ora: {
        all: oraType('schedule_followup'),
        send: oraType('send_followup'),
        sendApprovalRate: rate(ora['send_followup:executed'] ?? 0, (ora['send_followup:executed'] ?? 0) + (ora['send_followup:skipped'] ?? 0)),
        actionsProposed: Object.entries(ora).filter(([key]) => key.endsWith(':proposed')).reduce((sum, [, count]) => sum + count, 0),
      },
      retention: {
        customers,
        repeatCustomers,
        repeatRate: rate(repeatCustomers, customers),
        dormant: Number(lead.dormant ?? 0),
        outreach,
        convertedAfterOutreach,
        conversionRate: rate(convertedAfterOutreach, outreach),
        repeatCustomerRevenue: Math.round((Number(lead.revenueKobo ?? 0)) / 100),
      },
      mentor: {
        checkins: mentor.count,
        activeMentors: mentor.mentors,
      },
      roi: {
        tabViews: eventCounts['roi_tab_view'] ?? 0,
        analyticsOpens: eventCounts['roi_analytics_open'] ?? 0,
      },
      trust: {
        exports: eventCounts['trust_data_export'] ?? 0,
      },
      featureCounts,
    };
  }

  async firstCommissionMetrics(since) {
    const rows = await this.partners.aggregate([
      { $match: { activatedAt: { $gte: since }, accountState: 'partner' } },
      {
        $lookup: {
          from: 'growth_commissions',
          let: { pid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$earnerId', '$$pid'] } } },
            { $sort: { createdAt: 1 } },
            { $limit: 1 },
            { $project: { createdAt: 1 } },
          ],
          as: 'firstCommission',
        },
      },
      { $match: { 'firstCommission.0': { $exists: true } } },
      {
        $project: {
          days: {
            $divide: [
              { $subtract: [{ $arrayElemAt: ['$firstCommission.createdAt', 0] }, '$activatedAt'] },
              86400000,
            ],
          },
        },
      },
      { $sort: { days: 1 } },
    ]);

    const values = rows.map((row) => Number(row.days)).filter((n) => Number.isFinite(n) && n >= 0);
    if (values.length === 0) return { sample: 0, medianDays: null, p90Days: null };
    const pick = (pct) => values[Math.min(values.length - 1, Math.floor(pct * values.length))];
    return {
      sample: values.length,
      medianDays: Math.round(pick(0.5) * 10) / 10,
      p90Days: Math.round(pick(0.9) * 10) / 10,
    };
  }
}
