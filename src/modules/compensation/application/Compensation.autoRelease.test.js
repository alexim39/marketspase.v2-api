import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordAllocationCompensationUseCase } from './Compensation.usecases.js';
import { FulfillActivationOrderUseCase } from '../../onboarding/application/Onboarding.usecases.js';

test('allocation auto-releases commissions for a fulfilled order', async () => {
  const releasedCalls = [];
  const audits = [];
  const events = [];
  const usecase = new RecordAllocationCompensationUseCase({
    repo: {
      handleAllocation: async () => [
        { saleId: 's1', orderId: 'o1', partnerId: 'p1', entries: 2 },
        { saleId: 's2', orderId: 'o2', partnerId: 'p2', entries: 0 },
      ],
      releaseActivationOrder: async (orderId, adminId) => {
        releasedCalls.push([orderId, adminId]);
        return { released: 2, total: 150 };
      },
    },
    events: { emit: async (name) => events.push(name) },
    audit: (input) => audits.push(input),
  });

  const result = await usecase.execute({ partnerId: 'p1', ownerId: 'm1' });

  assert.equal(result.length, 2);
  assert.deepEqual(releasedCalls, [['o1', null]]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'commission.auto_release');
  assert.equal(audits[0].detail.trigger, 'allocation');
  assert.equal(events.length, 2);
});

test('marking an activation order fulfilled releases its pending commissions', async () => {
  const releasedCalls = [];
  const audits = [];
  const usecase = new FulfillActivationOrderUseCase({
    repo: {
      fulfillOrder: async () => ({ id: 'o1', orderNumber: 'MSA-1', status: 'Fulfilled' }),
    },
    commissions: {
      releaseActivationOrder: async (orderId, adminId) => {
        releasedCalls.push([orderId, adminId]);
        return { released: 3, total: 420 };
      },
    },
    audit: (input) => audits.push(input),
  });

  const order = await usecase.execute('o1', 'admin1');

  assert.equal(order.status, 'Fulfilled');
  assert.equal(order.autoRelease.released, 3);
  assert.deepEqual(releasedCalls, [['o1', 'admin1']]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'commission.auto_release');
  assert.equal(audits[0].detail.trigger, 'fulfillment');
});

test('fulfilment still succeeds when auto-release fails', async () => {
  const usecase = new FulfillActivationOrderUseCase({
    repo: {
      fulfillOrder: async () => ({ id: 'o1', status: 'Fulfilled' }),
    },
    commissions: {
      releaseActivationOrder: async () => { throw new Error('ledger unavailable'); },
    },
    audit: () => null,
  });

  const order = await usecase.execute('o1', 'admin1');

  assert.equal(order.status, 'Fulfilled');
  assert.deepEqual(order.autoRelease, { error: true });
});

test('fulfilment works without a commission dependency', async () => {
  const usecase = new FulfillActivationOrderUseCase({
    repo: { fulfillOrder: async () => ({ id: 'o1', status: 'Fulfilled' }) },
  });

  const order = await usecase.execute('o1', 'admin1');

  assert.equal(order.status, 'Fulfilled');
  assert.equal(order.autoRelease, null);
});
