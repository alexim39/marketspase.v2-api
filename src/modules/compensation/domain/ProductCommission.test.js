import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productCommissionShares,
  productLineMargin,
  summarizeProductMargins,
} from './ProductCommission.js';

test('productLineMargin subtracts COGS, shipping and the payment fee', () => {
  const margin = productLineMargin({
    price: 20000,
    quantity: 1,
    cogs: 8000,
    shippingCost: 2000,
  });

  // 20,000 − 8,000 − 2,000 − 300 fee
  assert.equal(margin, 9700);
});

test('productLineMargin scales costs with quantity', () => {
  const margin = productLineMargin({
    price: 10000,
    quantity: 2,
    cogs: 4000,
    shippingCost: 500,
  });

  // 20,000 − 8,000 − 1,000 − 300 fee
  assert.equal(margin, 10700);
});

test('productLineMargin never goes below zero', () => {
  assert.equal(productLineMargin({ price: 1000, quantity: 1, cogs: 1000, shippingCost: 500 }), 0);
  assert.equal(productLineMargin({ price: 0, quantity: 1 }), 0);
  assert.equal(productLineMargin({ price: 1000, quantity: 0 }), 0);
});

test('summarizeProductMargins excludes non-commissionable lines from the payout base', () => {
  const lines = [
    { price: 20000, quantity: 1, cogs: 8000, shippingCost: 2000, commissionable: true },
    { price: 10000, quantity: 1, cogs: 1000, shippingCost: 0, commissionable: false },
  ];
  const result = summarizeProductMargins(lines);

  assert.equal(result.grossMargin, 9700 + 8850);
  assert.equal(result.commissionableMargin, 9700);
});

test('summarizeProductMargins treats a missing commissionable flag as not commissionable', () => {
  const result = summarizeProductMargins([
    { price: 20000, quantity: 1, cogs: 8000, shippingCost: 2000 },
  ]);

  assert.equal(result.grossMargin, 9700);
  assert.equal(result.commissionableMargin, 0);
});

test('summarizeProductMargins returns zero for an empty cart', () => {
  assert.deepEqual(summarizeProductMargins([]), { grossMargin: 0, commissionableMargin: 0 });
});

test('productCommissionShares follows the 9/4.5/2.5/1.5/1 growth rates', () => {
  const shares = productCommissionShares(9700);

  assert.deepEqual(
    shares.map((share) => ({ level: share.level, amount: share.amount })),
    [
      { level: 1, amount: 873 },
      { level: 2, amount: 436.5 },
      { level: 3, amount: 242.5 },
      { level: 4, amount: 145.5 },
      { level: 5, amount: 97 },
    ],
  );
  assert.equal(
    shares.reduce((total, share) => total + share.amount, 0),
    1794.5,
  );
});

test('productCommissionShares returns nothing for zero margin', () => {
  assert.deepEqual(productCommissionShares(0), []);
});
