import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ListFinanceTransactionsUseCase } from './ListFinanceTransactions.usecase.js';

describe('finance transactions use case', () => {
  it('passes filters and pagination to the repository', async () => {
    let seen = null;
    const uc = new ListFinanceTransactionsUseCase({
      repo: {
        transactions: async (input) => {
          seen = input;
          return { items: [], total: 0, limit: input.limit, skip: input.skip, totals: { amount: 0, count: 0 } };
        },
      },
    });
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-11-01T00:00:00Z');
    await uc.execute({ type: 'withdrawals', status: 'Paid', q: 'ada', from, to, limit: 25, skip: 50 });
    assert.equal(seen.type, 'withdrawals');
    assert.equal(seen.status, 'Paid');
    assert.equal(seen.q, 'ada');
    assert.equal(seen.from, from);
    assert.equal(seen.to, to);
    assert.equal(seen.limit, 25);
    assert.equal(seen.skip, 50);
  });
});
