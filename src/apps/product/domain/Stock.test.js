import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateStockRequirements, isStockTracked } from './Stock.js';

test('isStockTracked accepts finite numbers and rejects null/undefined', () => {
  assert.equal(isStockTracked({ stock: 0 }), true);
  assert.equal(isStockTracked({ stock: 12 }), true);
  assert.equal(isStockTracked({ stock: null }), false);
  assert.equal(isStockTracked({}), false);
  assert.equal(isStockTracked({ stock: '12' }), false);
});

test('aggregateStockRequirements sums duplicate lines for the same product', () => {
  const requirements = aggregateStockRequirements([
    { product: 'p1', quantity: 2, stockTracked: true },
    { product: 'p1', quantity: 3, stockTracked: true, saleMode: 'resale' },
    { product: 'p2', quantity: 1, stockTracked: false },
    { product: 'p3', quantity: 4, stockTracked: true },
  ]);

  assert.deepEqual([...requirements.entries()], [['p1', 5], ['p3', 4]]);
});

test('aggregateStockRequirements ignores zero and negative quantities', () => {
  const requirements = aggregateStockRequirements([
    { product: 'p1', quantity: 0, stockTracked: true },
    { product: 'p2', quantity: -2, stockTracked: true },
  ]);

  assert.equal(requirements.size, 0);
});
