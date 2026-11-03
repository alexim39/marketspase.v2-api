import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpayConfig } from './Deposit.routes.js';
import { OPAY_TEST_BASE, OPAY_LIVE_BASE } from '../infrastructure/OpayClient.js';

test('resolveOpayConfig defaults to TEST_* keys', () => {
  const c = resolveOpayConfig({
    OPAY_TEST_PUBLIC_KEY: 'pub',
    OPAY_TEST_PRIVATE_KEY: 'prv',
    OPAY_MERCHANT_ID: 'm1',
  });
  assert.equal(c.mode, 'test');
  assert.equal(c.baseUrl, OPAY_TEST_BASE);
  assert.equal(c.publicKey, 'pub');
  assert.equal(c.privateKey, 'prv');
  assert.equal(c.merchantId, 'm1');
});

test('resolveOpayConfig selects LIVE_* keys when OPAY_MODE=live', () => {
  const c = resolveOpayConfig({
    OPAY_MODE: 'live',
    OPAY_LIVE_PUBLIC_KEY: 'lpub',
    OPAY_LIVE_PRIVATE_KEY: 'lprv',
    OPAY_MERCHANT_ID: 'm1',
  });
  assert.equal(c.mode, 'live');
  assert.equal(c.baseUrl, OPAY_LIVE_BASE);
  assert.equal(c.publicKey, 'lpub');
  assert.equal(c.privateKey, 'lprv');
});

test('resolveOpayConfig falls back to legacy single-key names', () => {
  const c = resolveOpayConfig({ OPAY_PUBLIC_KEY: 'old-pub', OPAY_PRIVATE_KEY: 'old-prv' });
  assert.equal(c.mode, 'test');
  assert.equal(c.publicKey, 'old-pub');
  assert.equal(c.privateKey, 'old-prv');
});
