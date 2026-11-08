import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildStoreRouter } from './Store.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

const partnerId = '507f1f77bcf86cd799439011';
const orderId = '507f1f77bcf86cd799439012';
const productId = '507f1f77bcf86cd799439013';

const auth = (req, _res, next) => {
  req.auth = { partnerId };
  next();
};

let updateBody = null;
let receiptId = null;
let orderUpdateBody = null;
let seenImageUpload = null;

const app = express();
app.use(express.json());
app.use('/v1/stores', buildStoreRouter({
  auth,
  audit: async () => null,
  idempotency: (req, res, next) => (
    req.get('Idempotency-Key')
      ? next()
      : res.status(400).json({ success: false, message: 'Idempotency-Key required', code: 'IDEMPOTENCY_KEY_REQUIRED' })
  ),
  images: {
    upload: async (buffer, meta) => {
      seenImageUpload = { bytes: buffer.length, meta };
      return { url: 'https://res.cloudinary.com/demo/image/upload/store-logo.png' };
    },
  },
  orderRepo: {
    createOrder: async (slug, body) => ({
      order: {
        reference: 'MS-TEST-ORDER-1',
        orderNumber: 'MS-TEST-1',
        store: { slug, name: 'Ada Store' },
        amounts: { total: 19500, currency: 'NGN' },
      },
      checkoutUrl: 'https://checkout.paystack.com/abc',
      orderToken: 'test-order-token',
      trackingUrl: 'https://marketspase.com/order/MS-TEST-ORDER-1?token=test-order-token',
      body,
    }),
    getOrder: async (reference, { token } = {}) => {
      if (token !== 'test-order-token') {
        const error = new Error('Order not found');
        error.statusCode = 404;
        throw error;
      }
      return { reference, status: 'pending_payment' };
    },
    verifyOrder: async (reference, { token } = {}) => {
      if (token !== 'test-order-token') {
        const error = new Error('Order not found');
        error.statusCode = 404;
        throw error;
      }
      return { order: { reference, status: 'paid' }, status: 'paid' };
    },
    listPartnerOrders: async () => ([
      { id: orderId, orderNumber: 'MS-TEST-1', status: 'paid', customer: { name: 'Ada' } },
    ]),
    getPartnerEarnings: async () => ({ pending: 0, released: 0, currency: 'NGN' }),
    updatePartnerOrder: async (_partner, id, body) => {
      orderUpdateBody = body;
      return { id, status: body.status, fulfilment: { courier: body.courier ?? '' } };
    },
    handleWebhook: async () => ({ handled: true, status: 'paid' }),
  },
  repo: {
    getMyStore: async () => ({
      store: { id: 'store-1', slug: 'ada', name: 'Ada Store', status: 'draft' },
      counts: { published: 1, draft: 2, paused: 0, pendingReceipts: 1 },
    }),
    updateMyStore: async (_partner, body) => {
      updateBody = body;
      return { id: 'store-1', slug: 'ada', name: body.name ?? 'Ada Store', status: body.status ?? 'draft' };
    },
    listMyProducts: async () => ([{ id: productId, name: 'Liven Coffee', retailPrice: 18000, stock: 3, status: 'draft' }]),
    updateProduct: async (_partner, id, body) => ({ id, status: body.status ?? 'draft', retailPrice: body.retailPrice ?? 18000 }),
    listReceipts: async () => ([{ id: orderId, orderNumber: 'PRD-1', items: [] }]),
    confirmReceipt: async (_partner, id) => {
      receiptId = id;
      return { orderNumber: 'PRD-1', credited: 3, listings: [{ id: productId }] };
    },
    listPublicStores: async (query) => ({
      data: [{ slug: 'ada', name: 'Ada Store', productCount: 2, q: query.q ?? '', cursor: query.cursor ?? '' }],
      meta: { count: 1, limit: query.limit ?? 30, hasMore: false, nextCursor: null, next_action: null },
    }),
    getPublicStore: async (slug) => ({
      store: { slug, name: 'Ada Store', status: 'published' },
      products: [{ id: productId, name: 'Liven Coffee', retailPrice: 18000, stock: 3 }],
    }),
    getPublicProduct: async (slug, id) => ({
      store: { slug, name: 'Ada Store' },
      product: { id, name: 'Liven Coffee', retailPrice: 18000, stock: 3 },
    }),
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

const request = async (path, method = 'GET', body, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
};

describe('store public routes', () => {
  it('lists and reads published stores', async () => {
    const list = await request('/v1/stores?q=ada');
    const store = await request('/v1/stores/ada');
    const product = await request(`/v1/stores/ada/products/${productId}`);

    assert.equal(list.status, 200);
    assert.equal(list.body.data[0].productCount, 2);
    assert.equal(list.body.meta.limit, 30);
    assert.equal(list.body.meta.hasMore, false);
    assert.equal(store.status, 200);
    assert.equal(store.body.data.store.slug, 'ada');
    assert.equal(product.status, 200);
    assert.equal(product.body.data.product.name, 'Liven Coffee');
  });

  it('creates a store order and returns the Paystack checkout', async () => {
    const created = await request('/v1/stores/ada/orders', 'POST', {
      items: [{ storeProductId: productId, quantity: 1 }],
      customer: {
        name: 'Ada Obi',
        email: 'ada@example.com',
        phone: '08030000000',
        street: '1 Market Road',
        city: 'Port Harcourt',
        state: 'Rivers',
      },
    }, { 'Idempotency-Key': 'test-checkout-key-1' });
    const order = await request('/v1/stores/orders/MS-TEST-ORDER-1?token=test-order-token');
    const verified = await request('/v1/stores/orders/MS-TEST-ORDER-1/verify?token=test-order-token', 'POST', {});
    const denied = await request('/v1/stores/orders/MS-TEST-ORDER-1');

    assert.equal(created.status, 200);
    assert.equal(created.body.data.checkoutUrl, 'https://checkout.paystack.com/abc');
    assert.equal(created.body.data.orderToken, 'test-order-token');
    assert.equal(order.status, 200);
    assert.equal(order.body.data.reference, 'MS-TEST-ORDER-1');
    assert.equal(verified.status, 200);
    assert.equal(verified.body.data.status, 'paid');
    assert.equal(denied.status, 404);
  });

  it('requires an idempotency key for checkout creation', async () => {
    const response = await fetch(`${baseUrl}/v1/stores/ada/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ storeProductId: productId, quantity: 1 }],
        customer: {
          name: 'Ada Obi', email: 'ada@example.com', phone: '08030000000',
          street: '1 Market Road', city: 'Port Harcourt', state: 'Rivers',
        },
      }),
    });
    assert.equal(response.status, 400);
  });

  it('accepts a signed webhook payload from the store route', async () => {
    const webhook = await request('/v1/stores/payments/webhook', 'POST', {
      event: 'charge.success',
      data: { reference: 'MS-TEST-ORDER-1' },
    });

    assert.equal(webhook.status, 200);
    assert.equal(webhook.body.data.status, 'paid');
  });
});

describe('store partner routes', () => {
  it('returns the partner store and updates settings', async () => {
    const mine = await request('/v1/stores/me');
    const updated = await request('/v1/stores/me', 'PATCH', { name: 'Ada Beauty', status: 'draft' });

    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.counts.published, 1);
    assert.equal(updated.status, 200);
    assert.equal(updateBody.name, 'Ada Beauty');
  });

  it('uploads a store logo through the image endpoint', async () => {
    const form = new FormData();
    form.append('kind', 'logo');
    form.append('image', new Blob(['fake-image'], { type: 'image/png' }), 'logo.png');
    const response = await fetch(`${baseUrl}/v1/stores/me/images`, { method: 'POST', body: form });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.kind, 'logo');
    assert.match(body.data.url, /cloudinary/);
    assert.equal(seenImageUpload.bytes, 10);
    assert.match(seenImageUpload.meta.publicId, new RegExp(`store-${partnerId}-logo-`));
  });

  it('rejects an unknown store image kind', async () => {
    const form = new FormData();
    form.append('kind', 'poster');
    form.append('image', new Blob(['x'], { type: 'image/png' }), 'poster.png');
    const response = await fetch(`${baseUrl}/v1/stores/me/images`, { method: 'POST', body: form });

    assert.equal(response.status, 400);
  });

  it('updates a listing and validates the price', async () => {
    const ok = await request(`/v1/stores/me/products/${productId}`, 'PATCH', {
      retailPrice: 19000,
      status: 'published',
    });
    const bad = await request(`/v1/stores/me/products/${productId}`, 'PATCH', {
      retailPrice: 0,
    });

    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.retailPrice, 19000);
    assert.equal(bad.status, 400);
  });

  it('confirms a received wholesale order', async () => {
    const receipt = await request(`/v1/stores/me/receipts/${orderId}/confirm`, 'POST', {});

    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.data.credited, 3);
    assert.equal(receiptId, orderId);
  });

  it('lists store orders and moves one through fulfilment', async () => {
    const orders = await request('/v1/stores/me/orders');
    const earnings = await request('/v1/stores/me/earnings');
    const updated = await request(`/v1/stores/me/orders/${orderId}`, 'PATCH', {
      status: 'shipped',
      courier: 'GIG',
      trackingNumber: 'GIG-100',
    });

    assert.equal(orders.status, 200);
    assert.equal(orders.body.data[0].orderNumber, 'MS-TEST-1');
    assert.equal(earnings.status, 200);
    assert.equal(earnings.body.data.currency, 'NGN');
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.status, 'shipped');
    assert.equal(orderUpdateBody.courier, 'GIG');
  });
});
