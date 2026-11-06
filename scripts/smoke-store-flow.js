import 'dotenv/config';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { StoreOrderRepository } from '../src/modules/stores/infrastructure/StoreOrder.mongo.repository.js';
import { StoreOrderModel } from '../src/modules/stores/infrastructure/Store.models.js';

/**
 * Repeatable commerce smoke test against a running API + seeded test DB.
 *
 * Prerequisites (from api/):
 *   1. MONGODB_DATABASE=marketspaseV2_e2e node scripts/seed-store-e2e.js
 *   2. PAYSTACKTOKEN=sk_test_e2e PAYSTACK_BASE_URL=http://localhost:4010 node scripts/mock-paystack-server.js
 *   3. PAYSTACKTOKEN=sk_test_e2e PAYSTACK_BASE_URL=http://localhost:4010 MONGODB_DATABASE=marketspaseV2_e2e MAIL_DISABLED=true npm start
 *   4. node scripts/smoke-store-flow.js
 *
 * The script never talks to the real Paystack API and refuses to run against a
 * database whose name does not contain "e2e" or "test".
 */

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=') || 'true'];
  }),
);

const API = String(args.get('api') ?? process.env.SMOKE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const SLUG = 'e2e-store';
const OWNER_EMAIL = 'store.owner.e2e@marketspase.test';
const OWNER_PASSWORD = 'E2eStore!2345';
const ADMIN_EMAIL = 'store.admin.e2e@marketspase.test';
const ADMIN_PASSWORD = 'E2eAdmin!2345';
const database = String(process.env.MONGODB_DATABASE ?? '').trim();

if (!/e2e|test/i.test(database)) {
  console.error(`Refusing to run against "${database || '(empty database)'}" - use an e2e/test database.`);
  process.exit(2);
}

const step = (message) => console.log(`\n▶ ${message}`);
const ok = (message) => console.log(`  ✓ ${message}`);
const ngn = (value) => `\u20A6${Number(value ?? 0).toLocaleString('en-NG')}`;

const request = async (path, { method = 'GET', body, token } = {}) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, body: payload };
};

const signIn = async (email, password) => {
  const response = await request('/v1/auth/signin', { method: 'POST', body: { email, password } });
  assert.equal(response.status, 200, `signin ${email}: ${JSON.stringify(response.body)}`);
  assert.ok(response.body?.data?.token, 'signin must return a token');
  return response.body.data.token;
};

const mongoUri = () => {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const username = encodeURIComponent(process.env.MONGODB_USERNAME ?? '');
  const password = encodeURIComponent(process.env.MONGODB_PASSWORD ?? '');
  const host = process.env.MONGODB_HOST ?? 'cluster0.ab5nviz.mongodb.net';
  return `mongodb+srv://${username}:${password}@${host}/${database}?retryWrites=true&w=majority`;
};

const markPaidOnMockGateway = async (checkoutUrl) => {
  const response = await fetch(`${checkoutUrl}/pay`, { method: 'POST', redirect: 'manual' });
  assert.ok([302, 303].includes(response.status), `mock checkout pay returned ${response.status}`);
};

const waitForStoreNotification = async (token, key) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request('/v1/notifications/list?limit=50', { token });
    const items = response.body?.data?.stored ?? [];
    if (items.some((item) => item.key === key)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

const createPaidOrder = async (customerSuffix = 'one') => {
  step(`Create and pay order (${customerSuffix})`);
  const store = await request(`/v1/stores/${SLUG}`);
  assert.equal(store.status, 200, JSON.stringify(store.body));
  const product = store.body.data.products.find((item) => item.name === 'E2E Test Product');
  assert.ok(product, 'seeded product must be published');

  const created = await request(`/v1/stores/${SLUG}/orders`, {
    method: 'POST',
    body: {
      items: [{ storeProductId: product.id, quantity: 1 }],
      customer: {
        name: `E2E Customer ${customerSuffix}`,
        email: `customer.${customerSuffix}@example.test`,
        phone: '08030000003',
        street: '1 Smoke Test Road',
        city: 'Port Harcourt',
        state: 'Rivers',
      },
    },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const reference = created.body.data.order.reference;
  const checkoutUrl = created.body.data.checkoutUrl;
  assert.ok(reference, 'order reference');
  assert.ok(checkoutUrl, 'checkout URL');
  ok(`order ${reference} created`);
  ok(`hosted checkout: ${checkoutUrl}`);

  const pending = await request(`/v1/stores/orders/${reference}`);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.data.status, 'pending_payment');
  ok('starts pending_payment');

  await markPaidOnMockGateway(checkoutUrl);
  ok('mock gateway marked paid and sent a signed webhook');

  const verified = await request(`/v1/stores/orders/${reference}/verify`, { method: 'POST', body: {} });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.data.status, 'paid');
  assert.equal(verified.body.data.order.escrow.status, 'held');
  ok(`verified paid; escrow held (${ngn(verified.body.data.order.amounts.partnerPending)})`);

  return verified.body.data.order;
};

const main = async () => {
  step('API health');
  const home = await fetch(`${API}/`);
  assert.equal(home.status, 200);
  const text = await home.text();
  assert.match(text, /Node server is up/);
  ok(`API reachable at ${API}`);

  const ownerToken = await signIn(OWNER_EMAIL, OWNER_PASSWORD);
  const adminToken = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  ok('owner and admin sign-in work');

  const first = await createPaidOrder('one');

  step('Partner notification');
  assert.equal(
    await waitForStoreNotification(ownerToken, `store-order-paid:${first.id}`),
    true,
    'paid order should create an in-app partner notification',
  );
  ok('new paid order appears in the partner notification center');

  step('Partner list and fulfil');
  const partnerOrders = await request('/v1/stores/me/orders', { token: ownerToken });
  assert.equal(partnerOrders.status, 200, JSON.stringify(partnerOrders.body));
  assert.ok(partnerOrders.body.data.some((order) => order.reference === first.reference));
  ok('paid order appears in the partner order list');

  const earningsBefore = await request('/v1/stores/me/earnings', { token: ownerToken });
  assert.equal(earningsBefore.status, 200);
  assert.ok(earningsBefore.body.data.pending > 0, 'escrow must be pending');
  ok(`pending earnings: ${ngn(earningsBefore.body.data.pending)}`);

  for (const update of [
    { status: 'processing' },
    { status: 'shipped', courier: 'E2E Courier', trackingNumber: 'E2E-TRACK-1' },
    { status: 'delivered' },
  ]) {
    const moved = await request(`/v1/stores/me/orders/${first.id}`, {
      method: 'PATCH',
      token: ownerToken,
      body: update,
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.data.status, update.status);
    ok(`moved to ${update.status}`);
  }

  const delivered = await request(`/v1/stores/orders/${first.reference}`);
  assert.equal(delivered.body.data.escrow.status, 'held');
  assert.ok(delivered.body.data.escrow.releaseAt, 'releaseAt must be scheduled');
  ok(`escrow release scheduled for ${delivered.body.data.escrow.releaseAt}`);

  step('Admin oversight and manual escrow release');
  const adminOrders = await request(`/v1/admin/store-orders?q=${encodeURIComponent(first.reference)}`, { token: adminToken });
  assert.equal(adminOrders.status, 200, JSON.stringify(adminOrders.body));
  assert.equal(adminOrders.body.data.length, 1);
  assert.equal(adminOrders.body.data[0].id, first.id);
  ok('admin sees the delivered order');

  const settlementsBefore = await request('/v1/admin/store-settlements', { token: adminToken });
  assert.equal(settlementsBefore.status, 200);
  assert.ok(settlementsBefore.body.data.heldOrders >= 1);
  ok(`settlements: ${settlementsBefore.body.data.heldOrders} held order(s), ${ngn(settlementsBefore.body.data.heldAmount)}`);

  const released = await request(`/v1/admin/store-orders/${first.id}/release-escrow`, {
    method: 'POST',
    token: adminToken,
    body: {},
  });
  assert.equal(released.status, 200, JSON.stringify(released.body));
  assert.equal(released.body.data.escrow.status, 'released');
  ok(`escrow released: ${ngn(released.body.data.amounts.partnerPending)}`);

  const earningsAfter = await request('/v1/stores/me/earnings', { token: ownerToken });
  assert.equal(earningsAfter.status, 200);
  assert.ok(earningsAfter.body.data.released > 0, 'released earnings must be credited');
  ok(`released earnings: ${ngn(earningsAfter.body.data.released)}`);

  const me = await request('/v1/auth/me', { token: ownerToken });
  assert.equal(me.status, 200);
  assert.ok(Number(me.body.data.balance) > 0, 'partner wallet balance must increase');
  ok(`partner wallet balance: ${ngn(me.body.data.balance)}`);

  step('Scheduled escrow release path');
  const second = await createPaidOrder('two');
  for (const update of [
    { status: 'processing' },
    { status: 'shipped', courier: 'E2E Courier', trackingNumber: 'E2E-TRACK-2' },
    { status: 'delivered' },
  ]) {
    const moved = await request(`/v1/stores/me/orders/${second.id}`, {
      method: 'PATCH',
      token: ownerToken,
      body: update,
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
  }

  await mongoose.connect(mongoUri());
  try {
    await StoreOrderModel.updateOne(
      { _id: second.id },
      { $set: { 'escrow.releaseAt': new Date(Date.now() - 60_000) } },
    );
    const result = await new StoreOrderRepository().releaseDueEscrows();
    assert.equal(result.released, 1, JSON.stringify(result));
    const fresh = await StoreOrderModel.findById(second.id).lean();
    assert.equal(fresh.escrow.status, 'released');
    ok('releaseDueEscrows() released the due order');
  } finally {
    await mongoose.disconnect().catch(() => null);
  }

  const finalEarnings = await request('/v1/stores/me/earnings', { token: ownerToken });
  assert.ok(finalEarnings.body.data.released > earningsAfter.body.data.released);
  ok(`final released earnings: ${ngn(finalEarnings.body.data.released)}`);

  step('Admin refund path');
  const third = await createPaidOrder('three');
  const refunded = await request(`/v1/admin/store-orders/${third.id}/refund`, {
    method: 'POST',
    token: adminToken,
    body: { reason: 'Commerce smoke test refund' },
  });
  assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
  assert.equal(refunded.body.data.status, 'refunded');
  assert.equal(refunded.body.data.payment.status, 'refunded');
  assert.equal(refunded.body.data.escrow.status, 'refunded');
  ok(`order refunded (${refunded.body.data.refundReference || 'provider pending'})`);

  assert.equal(
    await waitForStoreNotification(ownerToken, `store-order-refunded:${third.id}`),
    true,
    'refund should create an in-app partner notification',
  );
  ok('refund appears in the partner notification center');

  console.log('\nCommerce smoke test passed.');
};

main().catch(async (error) => {
  console.error('\nCommerce smoke test failed:', error?.stack ?? error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
