import test from 'node:test';
import assert from 'node:assert/strict';
import { GetActionInboxUseCase } from './ActionInbox.usecase.js';

const now = new Date('2026-11-13T10:00:00Z');

const deps = (over = {}) => ({
  reminders: {
    execute: async () => ({
      overdue: [{ prospectId: 'p1' }, { prospectId: 'p2' }],
      today: [{ prospectId: 'p3' }],
      upcoming: [],
      total: 3,
    }),
  },
  customerLeads: {
    list: async () => ({ total: 4, items: [] }),
  },
  campaigns: {
    listMine: async () => ([
      { status: 'Active', flight: { endAt: '2026-11-15T00:00:00Z' }, budget: { remaining: 5000 } },
      { status: 'Ended', flight: { endAt: '2026-11-15T00:00:00Z' }, budget: { remaining: 0 } },
    ]),
  },
  progression: {
    execute: async () => ({ percent: 20, next: 'builder', forecast: { stalled: true } }),
  },
  compensation: {
    execute: async () => ({ summary: { pending: 1500 }, mentorBonuses: [] }),
  },
  ...over,
});

test('builds a prioritized resolve-this list from live state', async () => {
  const inbox = new GetActionInboxUseCase(deps());
  const out = await inbox.execute({ partnerId: 'p1', now });
  assert.equal(out.total, 5);
  assert.equal(out.items[0].category, 'followup');
  assert.equal(out.items[0].count, 3);
  assert.equal(out.items.find((i) => i.category === 'reorder').count, 4);
  assert.equal(out.items.find((i) => i.category === 'campaign').count, 1);
  assert.equal(out.items.find((i) => i.category === 'rank').count, 1);
  assert.equal(out.items.find((i) => i.category === 'payout').count, 1);
});

test('omits empty categories', async () => {
  const inbox = new GetActionInboxUseCase(deps({
    reminders: { execute: async () => ({ overdue: [], today: [], upcoming: [], total: 0 }) },
    customerLeads: { list: async () => ({ total: 0, items: [] }) },
    campaigns: { listMine: async () => [] },
    progression: { execute: async () => ({ percent: 80, next: null, forecast: null }) },
    compensation: { execute: async () => ({ summary: { pending: 0 }, mentorBonuses: [] }) },
  }));
  const out = await inbox.execute({ partnerId: 'p1', now });
  assert.deepEqual(out.items, []);
});
