import test from 'node:test';
import assert from 'node:assert/strict';
import { storePricing, toKobo, fromKobo, storeServiceFeePercent } from './StorePricing.js';

test('store pricing keeps delivery pass-through and takes 2% of merchandise', () => {
  const out = storePricing({ merchandiseKobo: 5000000, deliveryKobo: 150000, percent: 2 });
  assert.equal(out.merchandiseKobo, 5000000);
  assert.equal(out.deliveryKobo, 150000);
  assert.equal(out.totalKobo, 5150000);
  assert.equal(out.serviceFeeKobo, 100000);
  assert.equal(out.partnerPendingKobo, 5050000);
});

test('store pricing never lets delivery affect the service fee', () => {
  const withDelivery = storePricing({ merchandiseKobo: 100000, deliveryKobo: 900000, percent: 2 });
  const withoutDelivery = storePricing({ merchandiseKobo: 100000, deliveryKobo: 0, percent: 2 });
  assert.equal(withDelivery.serviceFeeKobo, withoutDelivery.serviceFeeKobo);
});

test('kobo conversion rounds to the nearest kobo', () => {
  assert.equal(toKobo(100.005), 10001);
  assert.equal(fromKobo(10001), 100.01);
});

test('service fee is configurable and clamped', () => {
  const previous = process.env.STORE_SERVICE_FEE_PERCENT;
  process.env.STORE_SERVICE_FEE_PERCENT = '2.5';
  assert.equal(storeServiceFeePercent(), 2.5);
  process.env.STORE_SERVICE_FEE_PERCENT = '99';
  assert.equal(storeServiceFeePercent(), 20);
  process.env.STORE_SERVICE_FEE_PERCENT = previous;
});
