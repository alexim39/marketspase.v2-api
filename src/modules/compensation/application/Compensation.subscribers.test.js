import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DomainEvents } from '../../../shared/events/DomainEvents.js';
import { subscribeCompensation } from './Compensation.subscribers.js';

describe('compensation event wiring', () => {
  it('records activation, allocation, refund and rank events', async () => {
    const events = new DomainEvents();
    const seen = [];
    const off = subscribeCompensation({
      events,
      useCases: {
        activated: async (payload) => seen.push({ kind: 'activated', payload }),
        allocated: async (payload) => seen.push({ kind: 'allocated', payload }),
        refunded: async (payload) => seen.push({ kind: 'refunded', payload }),
        promoted: async (payload) => seen.push({ kind: 'promoted', payload }),
        demoted: async (payload) => seen.push({ kind: 'demoted', payload }),
      },
    });

    await events.emit('partner.activated', { partnerId: 'p1', orderId: 'o1', grossMargin: 18430 });
    await events.emit('partner.allocated', { partnerId: 'p1', ownerId: 'm1', campaignId: 'c1' });
    await events.emit('partner.activation_refunded', { partnerId: 'p1', orderId: 'o1' });
    await events.emit('progression.promoted', { partnerId: 'p1', from: 'partner', to: 'builder' });
    await events.emit('progression.demoted', { partnerId: 'p1', from: 'builder', to: 'partner' });

    assert.equal(seen.length, 5);
    assert.equal(seen[0].kind, 'activated');
    assert.equal(seen[0].payload.grossMargin, 18430);
    assert.equal(seen[1].kind, 'allocated');
    assert.equal(seen[1].payload.ownerId, 'm1');
    assert.equal(seen[2].kind, 'refunded');
    assert.equal(seen[3].kind, 'promoted');
    assert.equal(seen[4].kind, 'demoted');

    off();
    await events.emit('partner.activated', { partnerId: 'p2', orderId: 'o2' });
    assert.equal(seen.length, 5);
  });
});
