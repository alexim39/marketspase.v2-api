import test from 'node:test';
import assert from 'node:assert/strict';
import { GetFeatureAdoptionUseCase, RecordFeatureEventsUseCase } from './FeatureAdoption.usecases.js';

test('records bounded feature events', async () => {
  const rows = [];
  const usecase = new RecordFeatureEventsUseCase({
    events: { recordMany: async (partnerId, input) => { rows.push({ partnerId, input }); return { recorded: input.length }; } },
  });
  const out = await usecase.execute({
    partnerId: 'p1',
    rows: [
      { event: 'launch_path_view', feature: 'launch_path' },
      { event: 'roi_tab_view', feature: 'campaign_roi' },
    ],
  });
  assert.equal(out.recorded, 2);
  assert.equal(rows[0].input.length, 2);
});

test('rejects an empty event batch', async () => {
  const usecase = new RecordFeatureEventsUseCase({ events: { recordMany: async () => ({ recorded: 0 }) } });
  await assert.rejects(usecase.execute({ partnerId: 'p1', rows: [] }), /between 1 and 50/i);
});

const adoption = () => new GetFeatureAdoptionUseCase({
  events: {
    byEventSince: async () => ([
      { event: 'launch_path_view', count: 10, partners: 8 },
      { event: 'launch_path_completed', count: 4, partners: 4 },
      { event: 'trust_data_export', count: 2, partners: 2 },
      { event: 'roi_tab_view', count: 6, partners: 5 },
    ]),
    byFeatureSince: async () => [{ feature: 'launch_path', count: 14, partners: 8 }],
    totalSince: async () => ({ count: 22, partners: 9 }),
  },
  oraActions: {
    aggregate: async () => ([
      { _id: { type: 'send_followup', status: 'proposed' }, count: 5 },
      { _id: { type: 'send_followup', status: 'executed' }, count: 4 },
      { _id: { type: 'send_followup', status: 'skipped' }, count: 2 },
    ]),
  },
  customerLeads: {
    aggregate: async () => ([{
      customers: 40, repeatCustomers: 12, dormant: 8, outreach: 10, convertedAfterOutreach: 3, revenueKobo: 5000000,
    }]),
  },
  partners: {
    aggregate: async () => ([{ days: 2 }, { days: 4 }, { days: 6 }, { days: 10 }]),
  },
  checkins: { statsSince: async () => ({ count: 15, mentors: 4 }) },
});

test('maps adoption metrics and time to first commission', async () => {
  const out = await adoption().execute({ days: 30, now: new Date('2026-11-13T10:00:00Z') });
  assert.equal(out.events.total, 22);
  assert.equal(out.launch.views, 10);
  assert.equal(out.launch.completionRate, 40);
  assert.equal(out.trust.exports, 2);
  assert.equal(out.roi.tabViews, 6);
  assert.equal(out.ora.sendApprovalRate, 66.7);
  assert.equal(out.retention.repeatRate, 30);
  assert.equal(out.retention.conversionRate, 30);
  assert.equal(out.mentor.checkins, 15);
  assert.equal(out.launch.timeToFirstCommission.medianDays, 6);
  assert.equal(out.launch.timeToFirstCommission.p90Days, 10);
});
