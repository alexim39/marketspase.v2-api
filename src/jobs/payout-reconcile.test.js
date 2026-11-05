import test from 'node:test';
import assert from 'node:assert/strict';
import { runPayoutReconcileJob } from './payout-reconcile.js';

const rowsQuery = (rows) => ({
  sort: () => ({
    limit: () => ({
      lean: async () => rows,
    }),
  }),
});

test('payout reconcile settles a successful transfer and notifies once', async () => {
  const row = {
    _id: 't1', reference: 'WD1', partnerId: 'p1', amount: 1000,
    bank: 'GTBank', accountName: 'Ada Obi', status: 'Pending', payoutMode: 'automatic',
  };
  const transactions = {
    find: () => rowsQuery([row]),
    findOneAndUpdate: async () => ({ ...row, status: 'Paid', transferStatus: 'success' }),
  };
  const seen = [];
  const out = await runPayoutReconcileJob({
    paystack: {
      enabled: true,
      verifyTransfer: async () => ({ status: 'success', transfer_code: 'TRF_1' }),
    },
    transactions,
    partners: {},
    notifier: async (payload) => { seen.push(payload); },
  });
  assert.deepEqual(out, { checked: 1, settled: 1, failed: 0 });
  assert.equal(seen[0].outcome, 'paid');
});

test('payout reconcile refunds a debit whose transfer was never created', async () => {
  const row = {
    _id: 't1', reference: 'WD1', partnerId: 'p1', amount: 1000,
    status: 'Pending', payoutMode: 'automatic',
    payoutInitiatedAt: new Date(Date.now() - 15 * 60 * 1000),
    bank: 'GTBank', accountName: 'Ada Obi',
  };
  let refund = null;
  const transactions = {
    find: () => rowsQuery([row]),
    findOneAndUpdate: async (_filter, update) => ({ ...row, ...update.$set }),
    create: async ([doc]) => { refund = doc; return [doc]; },
  };
  const notFound = new Error('Transfer not found');
  notFound.code = 'TRANSFER_NOT_FOUND';
  const out = await runPayoutReconcileJob({
    paystack: { enabled: true, verifyTransfer: async () => { throw notFound; } },
    transactions,
    partners: { updateOne: async () => ({}) },
    notifier: async () => {},
  });
  assert.deepEqual(out, { checked: 0, settled: 1, failed: 0 });
  assert.equal(refund.paymentMethod, 'Withdrawal Refund');
  assert.equal(refund.amount, 1000);
});

test('payout reconcile does nothing when Paystack is disabled', async () => {
  const out = await runPayoutReconcileJob({
    paystack: { enabled: false },
    transactions: { find: () => { throw new Error('must not query'); } },
  });
  assert.deepEqual(out, { checked: 0, settled: 0, failed: 0 });
});
