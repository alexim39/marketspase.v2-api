import assert from 'node:assert/strict';
import test from 'node:test';
import { AccrueCommissionsUseCase } from './Commission.commands.js';

test('legacy accrual skips carts on the product growth plan', async () => {
  let inserted = false;
  const useCase = new AccrueCommissionsUseCase({
    ledger: {
      findByCart: async () => [],
      insertMany: async () => {
        inserted = true;
        return [];
      },
    },
    orders: {
      findCart: async () => ({
        id: 'cart-1',
        buyerId: 'buyer-1',
        total: 10000,
        commissionPlan: 'growth',
      }),
    },
    network: {
      findNode: async () => {
        throw new Error('growth carts must not walk the legacy tree');
      },
    },
  });

  const result = await useCase.execute({ cartId: 'cart-1' });

  assert.equal(result.skipped, true);
  assert.equal(result.accrued, 0);
  assert.equal(inserted, false);
});
