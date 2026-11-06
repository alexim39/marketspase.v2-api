import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildAdminStoreRouter } from './AdminStore.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

const partnerId = '507f1f77bcf86cd799439011';
const storeId = '507f1f77bcf86cd799439012';
const orderId = '507f1f77bcf86cd799439013';

const auth = (req, _res, next) => {
  req.auth = { partnerId };
  next();
};
const role = () => (req, _res, next) => next();

const store = {
  id: storeId,
  slug: 'ada',
  name: 'Ada Store',
  status: 'published',
  deliveryFee: 1500,
  productCount: 2,
  publishedCount: 2,
  stockUnits: 10,
  orderCount: 3,
  paidOrders: 2,
};

const order = {
  id: orderId,
  orderNumber: 'MS-1',
  reference: 'MS-REF-1',
  status: 'delivered',
  escrow: { status: 'held', releaseAt: '2026-11-01T00:00:00.000Z', releasedAt: null },
  amounts: { total: 19500, partnerPending: 19140 },
};

let released = false;
let statusBody = null;
let settingsBody = null;

const app = express();
app.use(express.json());
app.use('/v1/admin', buildAdminStoreRouter({
  auth,
  role,
  audit: async () => null,
  repo: {
    listStores: async () => [store],
    getStore: async () => ({ store, listings: [], orders: [order] }),
    setStoreStatus: async (_id, body) => {
      statusBody = body;
      return { ...store, status: body.status };
    },
    listOrders: async () => [order],
    getOrder: async () => order,
    releaseEscrow: async () => {
      released = true;
      return { ...order, escrow: { ...order.escrow, status: 'released', releasedAt: '2026-11-02T00:00:00.000Z' } };
    },
    settlements: async () => ({
      heldAmount: 19140,
      releasedAmount: 0,
      serviceFees: 360,
      paymentFees: 0,
      heldOrders: 1,
      releasedOrders: 0,
      deliveredAwaitingRelease: 1,
      currency: 'NGN',
      escrowHoldDays: 7,
    }),
    settings: async () => ({ serviceFeePercent: 2, escrowHoldDays: 7, currency: 'NGN' }),
    updateSettings: async (body) => {
      settingsBody = body;
      return { ...body, currency: 'NGN' };
    },
  },
}));
app.use(errorMiddleware);

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const request = async (path, method = 'GET', body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
};

describe('admin store routes', () => {
  it('lists stores, orders and settlements', async () => {
    const stores = await request('/v1/admin/stores');
    const detail = await request(`/v1/admin/stores/${storeId}`);
    const orders = await request('/v1/admin/store-orders');
    const settlements = await request('/v1/admin/store-settlements');

    assert.equal(stores.status, 200);
    assert.equal(stores.body.data[0].slug, 'ada');
    assert.equal(detail.body.data.listings.length, 0);
    assert.equal(orders.body.data[0].orderNumber, 'MS-1');
    assert.equal(settlements.body.data.heldAmount, 19140);
  });

  it('updates store status and validates the payload', async () => {
    const updated = await request(`/v1/admin/stores/${storeId}/status`, 'PATCH', {
      status: 'suspended',
      reason: 'Policy review',
    });
    const bad = await request(`/v1/admin/stores/${storeId}/status`, 'PATCH', {
      status: 'nonsense',
    });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.status, 'suspended');
    assert.equal(statusBody.reason, 'Policy review');
    assert.equal(bad.status, 400);
  });

  it('releases escrow for a delivered order', async () => {
    const response = await request(`/v1/admin/store-orders/${orderId}/release-escrow`, 'POST', {});
    assert.equal(response.status, 200);
    assert.equal(released, true);
    assert.equal(response.body.data.escrow.status, 'released');
  });

  it('reads and updates store settings', async () => {
    const current = await request('/v1/admin/settings/store');
    const updated = await request('/v1/admin/settings/store', 'PUT', {
      serviceFeePercent: 2.5,
      escrowHoldDays: 7,
    });

    assert.equal(current.status, 200);
    assert.equal(current.body.data.serviceFeePercent, 2);
    assert.equal(updated.status, 200);
    assert.equal(settingsBody.serviceFeePercent, 2.5);
    assert.equal(updated.body.data.escrowHoldDays, 7);
  });
});
