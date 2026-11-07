import test from 'node:test';
import assert from 'node:assert/strict';
import { OraContextAssembler } from './Ora.context.js';

const PID = '507f1f77bcf86cd799439011';

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
            date: new Date(Date.now() - 5 * 86400000).toISOString(),
            followUpDate: new Date(Date.now() - 2 * 86400000).toISOString(),
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
});

test('assembly carries wallet, stage mix and live opportunities', async () => {
  const ctx = await assembler().assemble({ partnerId: PID, now: new Date() });
  assert.equal(ctx.displayName, 'Ada Obi');
  assert.equal(ctx.walletBalance, 2500);
  assert.equal(ctx.pipeline.byStage.Contacted, 1);
  assert.equal(ctx.pipeline.byStage.New, 1);
  assert.ok(ctx.opportunities.some((o) => o.type === 'send_sms' && o.prospectName === 'Paul Obi'));
});
