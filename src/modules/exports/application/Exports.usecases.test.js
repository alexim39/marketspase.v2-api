import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportCommissionsUseCase } from './Exports.usecases.js';

test('commission export reads the growth ledger, not the legacy shop ledger', async () => {
  const calls = [];
  const uc = new ExportCommissionsUseCase({
    growth: {
      listForExport: async (partnerId, opts) => {
        calls.push({ partnerId, opts });
        return {
          entries: [{
            orderId: 'order-1',
            level: 2,
            rate: 0.045,
            grossMargin: 20000,
            amount: 900,
            status: 'Released',
            rankAtAccrual: 'Builder',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            releasedAt: new Date('2026-01-05T00:00:00Z'),
          }],
          bonuses: [{
            orderId: 'order-2',
            amount: 1000,
            status: 'paid',
            dueAt: new Date('2026-02-01T00:00:00Z'),
            paidAt: new Date('2026-02-01T00:00:00Z'),
          }],
        };
      },
    },
  });

  const result = await uc.execute({ partnerId: 'partner-1', limit: 200 });
  assert.deepEqual(calls, [{ partnerId: 'partner-1', opts: { limit: 200 } }]);
  assert.equal(result.count, 2);
  assert.equal(result.rows[0].type, 'Mentor bonus');
  assert.equal(result.rows[1].type, 'Commission');
  assert.equal(result.rows[1].rankAtAccrual, 'Builder');
  assert.equal(result.rows[1].rate, 0.045);
  const headers = result.columns.map((c) => c.header);
  assert.ok(headers.includes('Gross margin'));
  assert.ok(headers.includes('Rank at accrual'));
});
