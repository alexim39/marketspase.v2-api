import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { debitPartnerWallet } from './Deposit.usecases.js';

const wallet = ({ balance, bonusBalance }) => {
  const calls = [];
  const partners = {
    findById: () => ({
      select: () => {
        const query = {
          lean: async () => ({ balance, bonusBalance }),
          session: () => query,
        };
        return query;
      },
    }),
    findOneAndUpdate: async (guard, update) => {
      calls.push({ guard, update });
      return {
        balance: balance + (update.$inc?.balance ?? 0),
        bonusBalance: bonusBalance + (update.$inc?.bonusBalance ?? 0),
      };
    },
  };
  return { partners, calls };
};

describe('wallet debit policy', () => {
  it('refuses activation cash when bonus covers the shortfall', async () => {
    const { partners, calls } = wallet({ balance: 40000, bonusBalance: 5000 });
    const out = await debitPartnerWallet(
      { partners },
      { partnerId: 'p1', amountNgn: 38000, bonusPolicy: 'cash_only' },
    );
    assert.equal(out, null);
    assert.equal(calls.length, 0);
  });

  it('debits cash only and leaves bonus intact', async () => {
    const { partners, calls } = wallet({ balance: 43000, bonusBalance: 5000 });
    const out = await debitPartnerWallet(
      { partners },
      { partnerId: 'p1', amountNgn: 38000, bonusPolicy: 'cash_only' },
    );
    assert.ok(out);
    assert.equal(out.bonusUsed, 0);
    assert.equal(out.cashUsed, 38000);
    assert.equal(out.bonusBalance, 5000);
    assert.equal(calls[0].guard.balance.$gte, 43000);
    assert.deepEqual(calls[0].update.$inc, { balance: -38000 });
  });

  it('keeps spending bonus first for post-activation purchases', async () => {
    const { partners, calls } = wallet({ balance: 43000, bonusBalance: 5000 });
    const out = await debitPartnerWallet(
      { partners },
      { partnerId: 'p1', amountNgn: 38000 },
    );
    assert.ok(out);
    assert.equal(out.bonusUsed, 5000);
    assert.equal(out.cashUsed, 33000);
    assert.deepEqual(calls[0].update.$inc, { balance: -38000, bonusBalance: -5000 });
  });
});
