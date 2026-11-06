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

    assert.deepEqual(result, { status: 'notified', deduped: false });
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
    assert.deepEqual(result, { status: 'notified', deduped: true });
  });

  it('subscribes to store.order.paid', async () => {
    let handler = null;
    const off = () => {};
    const events = {
      on: (name, fn) => {
        assert.equal(name, 'store.order.paid');
        handler = fn;
        return off;
      },
    };
    const delivery = makeDelivery();
    const unsubscribe = subscribeStoreOrderFanout({
      events,
      delivery,
      partners: { findById: async () => partner },
    });
    assert.equal(unsubscribe, off);
    await handler({ partnerId: 'p1', orderId: 'o1', orderNumber: 'MS-1', customerName: 'Ada', total: 1 });
    assert.equal(delivery.calls.length, 1);
  });
});
