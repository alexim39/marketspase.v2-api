import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StoreOrderFanoutUseCase, subscribeStoreOrderFanout } from './StoreOrderFanout.js';

const partner = {
  id: 'p1',
  email: 'owner@example.com',
  phone: '08030000001',
};

const makeDelivery = (inApp = 'created') => {
  const calls = [];
  return {
    calls,
    async deliver(input) {
      calls.push(input);
      return { inApp, email: false, sms: false, push: 0, pruned: 0, errors: [] };
    },
  };
};

describe('StoreOrderFanoutUseCase', () => {
  it('creates an in-app fulfilment notification for the partner', async () => {
    const delivery = makeDelivery();
    const fanout = new StoreOrderFanoutUseCase({
      delivery,
      partners: { findById: async () => partner },
    });

    const result = await fanout.notifyPaid({
      partnerId: 'p1',
      orderId: 'o1',
      orderNumber: 'MS-1',
      customerName: 'Ada Obi',
      total: 11500,
      currency: 'NGN',
    });

    assert.equal(result.status, 'notified');
    assert.equal(result.emailed, false);
    assert.equal(result.report.inApp, 'created');
    assert.equal(delivery.calls.length, 1);
    const call = delivery.calls[0];
    assert.equal(call.recipientId, 'p1');
    assert.equal(call.contact.email, 'owner@example.com');
    assert.equal(call.item.category, 'system');
    assert.equal(call.item.priority, 'high');
    assert.equal(call.item.key, 'store-order-paid:o1');
    assert.equal(call.item.link, '/dashboard/products/store-orders');
    assert.match(call.item.title, /MS-1/);
    assert.match(call.item.body, /Ada Obi/);
    assert.match(call.item.body, /11,500/);
  });

  it('reports dedupe without treating it as a failure', async () => {
    const fanout = new StoreOrderFanoutUseCase({
      delivery: makeDelivery('deduped'),
      partners: { findById: async () => partner },
    });
    const result = await fanout.notifyPaid({
      partnerId: 'p1',
      orderId: 'o1',
      orderNumber: 'MS-1',
      customerName: 'Ada',
      total: 100,
    });
    assert.equal(result.status, 'notified');
    assert.equal(result.report.inApp, 'deduped');
  });

  it('subscribes to store.order.paid and store.order.refunded', async () => {
    const handlers = new Map();
    const events = {
      on: (name, fn) => {
        handlers.set(name, fn);
        return () => handlers.delete(name);
      },
    };
    const delivery = makeDelivery();
    const unsubscribe = subscribeStoreOrderFanout({
      events,
      delivery,
      partners: { findById: async () => partner },
    });
    assert.equal(typeof unsubscribe, 'function');
    assert.ok(handlers.has('store.order.paid'));
    assert.ok(handlers.has('store.order.refunded'));
    await handlers.get('store.order.paid')({
      partnerId: 'p1', orderId: 'o1', orderNumber: 'MS-1', customerName: 'Ada', total: 1,
    });
    assert.equal(delivery.calls.length, 1);
    unsubscribe();
    assert.equal(handlers.size, 0);
  });

  it('notifies the partner and emails the customer on a refund', async () => {
    const delivery = makeDelivery();
    const mails = [];
    const fanout = new StoreOrderFanoutUseCase({
      delivery,
      partners: { findById: async () => partner },
      mail: async (...args) => {
        mails.push(args);
        return { sent: true };
      },
    });
    const result = await fanout.notifyRefunded({
      partnerId: 'p1',
      orderId: 'o1',
      orderNumber: 'MS-1',
      customerName: 'Ada <Obi>',
      customerEmail: 'ada@example.com',
      total: 11500,
      currency: 'NGN',
      reason: 'Item returned',
      refundReference: 'REF-1',
    });
    assert.equal(result.status, 'notified');
    assert.equal(result.emailed, true);
    assert.equal(delivery.calls[0].item.key, 'store-order-refunded:o1');
    assert.match(delivery.calls[0].item.title, /refunded/i);
    assert.equal(mails.length, 1);
    assert.equal(mails[0][0], 'ada@example.com');
    assert.match(mails[0][1], /MS-1/);
    assert.match(mails[0][2], /Ada &lt;Obi&gt;/);
    assert.match(mails[0][2], /Item returned/);
    assert.match(mails[0][2], /REF-1/);
  });
});
