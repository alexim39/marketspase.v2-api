import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  buildAdminOnboardingRouter,
  buildOnboardingRouter,
} from './Onboarding.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

const partnerId = '507f1f77bcf86cd799439011';
const productId = '507f1f77bcf86cd799439012';
const orderId = '507f1f77bcf86cd799439013';

const auth = (req, _res, next) => {
  req.auth = { partnerId, role: 'admin' };
  next();
};

let seenOrderInput = null;
let repeated = false;

const app = express();
app.use(express.json());
app.use('/v1/onboarding', buildOnboardingRouter({
  auth,
  getStatus: {
    execute: async () => ({
      partner: { id: partnerId, accountState: 'member', kycStatus: 'pending', balance: 40000 },
      activationOrder: null,
      kyc: { status: 'pending' },
      queue: null,
    }),
  },
  listProducts: {
    execute: async () => [{ id: productId, sku: 'MS-STARTER-001', price: 38000 }],
  },
  submitKyc: {
    execute: async (_partnerId, input) => ({ status: 'verified', ...input }),
  },
  createOrder: {
    execute: async (input) => {
      seenOrderInput = input;
      return {
        order: {
          id: orderId,
          orderNumber: 'MSA-TEST-1',
          amount: 38000,
          currency: 'NGN',
          activatedAt: new Date().toISOString(),
        },
        queue: { status: 'queued', position: 1 },
        repeated,
      };
    },
  },
  listOrders: {
    execute: async () => [{ id: orderId, orderNumber: 'MSA-TEST-1' }],
  },
}));
app.use('/v1/admin/onboarding', buildAdminOnboardingRouter({
  auth,
  admin: (_req, _res, next) => next(),
  listAdminOrders: {
    execute: async (query) => ({
      data: [{ id: orderId, status: 'Paid' }],
      meta: { page: query.page, limit: query.limit, total: 1, pages: 1 },
    }),
  },
  listKyc: {
    execute: async () => ({ data: [], meta: { page: 1, limit: 25, total: 0, pages: 1 } }),
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

const post = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const shipping = {
  fullName: 'Ada Obi',
  phone: '+2348012345678',
  street: '12 Market Road',
  city: 'Lagos',
  state: 'Lagos',
};

describe('onboarding routes', () => {
  it('serves the activation status envelope', async () => {
    const response = await fetch(`${baseUrl}/v1/onboarding/status`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.partner.accountState, 'member');
    assert.equal(body.data.partner.balance, 40000);
  });

  it('creates an activation order with the idempotency key', async () => {
    const result = await post('/v1/onboarding/orders', {
      productId,
      shipping,
      idempotencyKey: 'idem-key-123',
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.data.queue.position, 1);
    assert.equal(seenOrderInput.idempotencyKey, 'idem-key-123');
    assert.equal(seenOrderInput.shipping.fullName, 'Ada Obi');
  });

  it('returns 200 instead of duplicating a replayed order', async () => {
    repeated = true;
    const result = await post('/v1/onboarding/orders', {
      productId,
      shipping,
      idempotencyKey: 'idem-key-123',
    });
    repeated = false;

    assert.equal(result.status, 200);
    assert.equal(result.body.message, 'Activation order already exists');
  });

  it('rejects a malformed product reference before the use case', async () => {
    seenOrderInput = null;
    const result = await post('/v1/onboarding/orders', {
      productId: 'starter',
      shipping,
    });

    assert.equal(result.status, 400);
    assert.equal(seenOrderInput, null);
  });

  it('rejects an incomplete shipping address', async () => {
    const result = await post('/v1/onboarding/orders', {
      productId,
      shipping: { fullName: 'Ada Obi' },
    });

    assert.equal(result.status, 400);
  });

  it('accepts an empty KYC form and completes it automatically', async () => {
    const result = await post('/v1/onboarding/kyc', {});

    assert.equal(result.status, 200);
    assert.equal(result.body.data.status, 'verified');
  });

  it('serves the admin activation order desk with pagination', async () => {
    const response = await fetch(`${baseUrl}/v1/admin/onboarding/orders?status=Paid&page=2`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data[0].status, 'Paid');
    assert.equal(body.meta.page, 2);
  });
});
