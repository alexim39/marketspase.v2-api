import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { customerOrder } from './StoreOrder.mongo.repository.js';

const order = {
  _id: '507f1f77bcf86cd799439012',
  reference: 'MS-TEST-ORDER-1',
  orderNumber: 'MS-260101-ABC123',
  storeId: '507f1f77bcf86cd799439013',
  storeSlug: 'ada',
  storeName: 'Ada Store',
  customer: {
    name: 'Ada Obi',
    email: 'ada@example.com',
    phone: '08030000000',
    street: '1 Market Road',
    city: 'Port Harcourt',
    state: 'Rivers',
    country: 'Nigeria',
    note: 'Leave at the gate',
  },
  items: [{
    storeProductId: '507f1f77bcf86cd799439014',
    productId: '507f1f77bcf86cd799439015',
    name: 'Liven Coffee',
    unitPriceKobo: 1800000,
    quantity: 1,
    lineTotalKobo: 1800000,
  }],
  amounts: {
    merchandiseKobo: 1800000,
    deliveryKobo: 150000,
    totalKobo: 1950000,
    serviceFeeKobo: 36000,
    serviceFeePercent: 2,
    paymentFeeKobo: 1000,
    partnerPendingKobo: 1904000,
  },
  payment: { provider: 'paystack', status: 'paid', reference: 'MS-TEST-ORDER-1', currency: 'NGN' },
  status: 'delivered',
  escrow: { status: 'held', releaseAt: null, releasedAt: null },
  fulfilment: { courier: 'GIG', trackingNumber: 'GIG-1' },
  events: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('customer order view', () => {
  it('masks customer identity, address and notes', () => {
    const view = customerOrder(order, { status: 'requested', reason: 'Wrong size' });
    assert.equal(view.customer.name, 'Ada O.');
    assert.equal(view.customer.email, 'a***@example.com');
    assert.equal(view.customer.phone, '*******0000');
    assert.equal(view.customer.street, '1***');
    assert.equal(view.customer.note, '');
    assert.equal(view.returnRequest.status, 'requested');
  });

  it('does not expose partner economics to the customer', () => {
    const view = customerOrder(order);
    assert.equal(view.amounts.total, 19500);
    assert.equal(view.amounts.serviceFee, undefined);
    assert.equal(view.amounts.partnerPending, undefined);
    assert.equal(view.payment.authorizationUrl, undefined);
  });
});
