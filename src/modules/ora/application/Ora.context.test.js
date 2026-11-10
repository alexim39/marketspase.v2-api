import test from 'node:test';
import assert from 'node:assert/strict';
import { OraContextAssembler } from './Ora.context.js';

const PID = '507f1f77bcf86cd799439011';
const NOW = new Date('2026-11-07T10:00:00Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

const assembler = () => new OraContextAssembler({
  prospects: {
    findByPartnerId: async () => ({
      total: 2,
      items: [
        {
          id: PID,
          prospectName: 'Paul',
          prospectSurname: 'Obi',
          prospectPhone: '08030000000',
          consentToContact: true,
          status: { stage: 'Contacted' },
          communications: [{
            status: 'Open',
            type: 'call',
            date: daysAgo(5),
            followUpDate: daysAgo(2),
          }],
        },
        {
          id: '507f1f77bcf86cd799439012',
          prospectName: 'Ada',
          status: { stage: 'New' },
          communications: [],
        },
      ],
    }),
  },
  goals: { execute: async () => [] },
  events: { execute: async () => ({ items: [] }) },
  notifications: { unreadCount: async () => 0 },
  partners: {
    findById: async () => ({
      name: 'Ada', surname: 'Obi', username: 'ada', commissionRank: 'Partner', balance: 2500,
    }),
  },
  network: {
    countChildren: async () => 1,
    recentChildren: async () => [{ name: 'Kemi', surname: 'Bello', username: 'kemi', commissionRank: 'Builder' }],
  },
  campaigns: {
    listMine: async () => [{
      name: 'Lagos growth', status: 'Active',
      budget: { remaining: 5000 }, capacity: { allocated: 2, total: 10 },
    }],
  },
  store: {
    getMyStore: async () => ({
      store: { slug: 'ada', name: 'Ada Store', status: 'published' },
      counts: { published: 3, draft: 1, pendingReceipts: 1 },
    }),
  },
  storeOrders: {
    listPartnerOrders: async () => [{ orderNumber: 'MS-1', status: 'paid' }],
  },
  plans: {
    get: async () => ({
      dateKey: '2026-11-07',
      items: [{ title: 'Follow up with Paul', link: '/dashboard/prospects/pipeline' }],
      source: 'ora',
      savedAt: new Date('2026-11-07T09:00:00Z'),
    }),
  },
});

test('assembly carries wallet, stage mix and live opportunities', async () => {
  const ctx = await assembler().assemble({ partnerId: PID, now: NOW });
  assert.equal(ctx.displayName, 'Ada Obi');
  assert.equal(ctx.walletBalance, 2500);
  assert.equal(ctx.pipeline.byStage.Contacted, 1);
  assert.equal(ctx.pipeline.byStage.New, 1);
  assert.equal(ctx.team.directPartners, 1);
  assert.equal(ctx.campaigns.active, 1);
  assert.equal(ctx.store.pendingReceipts, 1);
  assert.equal(ctx.plan.dateKey, '2026-11-07');
  assert.equal(ctx.plan.items[0].title, 'Follow up with Paul');
  assert.ok(ctx.opportunities.some((o) => o.type === 'open_page' && o.prospectName === 'Paul Obi'));
  assert.ok(ctx.opportunities.some((o) => o.capabilityKey === 'team.hub'));
  assert.ok(ctx.opportunities.some((o) => o.capabilityKey === 'products.store-orders'));
  assert.ok(ctx.opportunities.some((o) => o.id === 'opp:plan:today'));
});
