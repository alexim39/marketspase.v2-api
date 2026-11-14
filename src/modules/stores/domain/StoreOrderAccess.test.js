import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import {
  storeOrderAccessToken,
  storeOrderTrackingUrl,
  verifyStoreOrderAccessToken,
} from './StoreOrderAccess.js';

before(() => {
  process.env.STORE_ORDER_TOKEN_SECRET = 'unit-test-store-order-secret';
});

const order = { _id: '507f1f77bcf86cd799439012', reference: 'MS-TEST-ORDER-1' };

describe('store order access tokens', () => {
  it('derives a stable token and rejects tampering', () => {
    const token = storeOrderAccessToken(order);
    assert.ok(token.length > 20);
    assert.equal(token, storeOrderAccessToken({ ...order }));
    assert.equal(verifyStoreOrderAccessToken(order, token), true);
    assert.equal(verifyStoreOrderAccessToken(order, `${token}x`), false);
    assert.equal(verifyStoreOrderAccessToken(order, ''), false);
    assert.equal(verifyStoreOrderAccessToken({ ...order, reference: 'OTHER' }, token), false);
  });

  it('builds a tracking URL on the public store domain', () => {
    process.env.PUBLIC_SITE_URL = 'https://marketspase.com/';
    process.env.STORE_PUBLIC_URL = 'https://store.marketspase.com/';
    const url = storeOrderTrackingUrl(order);
    assert.match(url, /^https:\/\/store\.marketspase\.com\/order\/MS-TEST-ORDER-1\?token=/);
  });

  it('never derives the store link from the platform public site', (t) => {
    const previousStore = process.env.STORE_PUBLIC_URL;
    delete process.env.STORE_PUBLIC_URL;
    process.env.PUBLIC_SITE_URL = 'https://marketspase.com';
    process.env.FRONTEND_URL = 'https://marketspase.com';
    process.env.APP_BASE_URL = 'https://marketspase.com';
    t.after(() => {
      if (previousStore === undefined) delete process.env.STORE_PUBLIC_URL;
      else process.env.STORE_PUBLIC_URL = previousStore;
    });
    const url = storeOrderTrackingUrl(order);
    assert.match(url, /^https:\/\/store\.marketspase\.com\/order\//);
  });
});
