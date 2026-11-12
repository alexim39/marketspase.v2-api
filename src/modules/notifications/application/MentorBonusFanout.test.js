import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMPENSATION_EVENTS } from '../../compensation/domain/CompensationEvents.js';
import { buildMentorBonusCredited } from '../infrastructure/LifecycleMailer.js';
import { MentorBonusFanoutUseCase, subscribeMentorBonusFanout } from './MentorBonusFanout.js';

const mentor = {
  _id: 'mentor-1',
  name: 'Ada',
  surname: 'Obi',
  username: 'ada',
  email: 'ada@example.com',
  phone: '08030000001',
  suspendedAt: null,
};

const member = {
  _id: 'member-1',
  name: 'Bola',
  surname: 'Ade',
  username: 'bola',
};

const makePartners = (overrides = {}) => {
  const rows = new Map([
    ['mentor-1', mentor],
    ['member-1', member],
    ...Object.entries(overrides).map(([id, row]) => [id, row]),
  ]);
  return { findById: async (id) => rows.get(String(id)) ?? null };
};

const makeStored = (existing = null) => ({ findByKey: async () => existing });

const makeDelivery = ({ inApp = 'created', email = false, throws = false } = {}) => {
  const calls = [];
  return {
    calls,
    async deliver(input) {
      if (throws) throw new Error('mail provider down');
      calls.push(input);
      return { inApp, email, sms: false, push: 0, pruned: 0, errors: [] };
    },
  };
};

describe('MentorBonusFanoutUseCase', () => {
  it('confirms the wallet credit and the mentor bonus amount', async () => {
    const delivery = makeDelivery();
    const fanout = new MentorBonusFanoutUseCase({
      stored: makeStored(),
      delivery,
      partners: makePartners(),
    });

    const result = await fanout.notify({
      bonusId: 'bonus-1',
      mentorId: 'mentor-1',
      activationPartnerId: 'member-1',
      amount: 1000,
      balanceAfter: 51000,
    });

    assert.equal(result.status, 'notified');
    assert.equal(delivery.calls.length, 1);
    const call = delivery.calls[0];
    assert.equal(call.recipientId, 'mentor-1');
    assert.equal(call.contact.email, 'ada@example.com');
    assert.equal(call.item.category, 'commission');
    assert.equal(call.item.priority, 'high');
    assert.equal(call.item.key, 'mentor-bonus:paid:bonus-1');
    assert.equal(call.item.link, '/dashboard/wallet/history');
    assert.match(call.item.title, /₦1,000/);
    assert.match(call.item.body, /wallet has been credited/i);
    assert.match(call.item.body, /₦1,000/);
    assert.match(call.item.body, /₦51,000/);
    assert.match(call.item.body, /Bola Ade/);
    assert.match(call.email.subject, /mentor\/coach bonus/i);
    assert.match(call.email.html, /₦1,000/);
    assert.match(call.email.html, /Bola Ade/);
    assert.equal(call.emailPolicy, 'force');
  });

  it('does not send a duplicate wallet-credit alert', async () => {
    const delivery = makeDelivery();
    const fanout = new MentorBonusFanoutUseCase({
      stored: makeStored({ id: 'existing' }),
      delivery,
      partners: makePartners(),
    });

    const result = await fanout.notify({
      bonusId: 'bonus-1',
      mentorId: 'mentor-1',
      amount: 1000,
      balanceAfter: 51000,
    });

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'already-sent');
    assert.equal(delivery.calls.length, 0);
  });

  it('skips a suspended mentor', async () => {
    const delivery = makeDelivery();
    const fanout = new MentorBonusFanoutUseCase({
      stored: makeStored(),
      delivery,
      partners: makePartners({
        'mentor-1': { ...mentor, suspendedAt: new Date() },
      }),
    });

    const result = await fanout.notify({
      bonusId: 'bonus-1',
      mentorId: 'mentor-1',
      amount: 1000,
      balanceAfter: 51000,
    });

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'mentor-suspended');
    assert.equal(delivery.calls.length, 0);
  });

  it('returns a failed result instead of throwing when delivery breaks', async () => {
    const fanout = new MentorBonusFanoutUseCase({
      stored: makeStored(),
      delivery: makeDelivery({ throws: true }),
      partners: makePartners(),
    });

    const result = await fanout.notify({
      bonusId: 'bonus-1',
      mentorId: 'mentor-1',
      amount: 1000,
      balanceAfter: 51000,
    });

    assert.equal(result.status, 'failed');
    assert.match(result.error, /mail provider down/);
  });

  it('subscribes to the mentor-bonus-paid event', async () => {
    const handlers = new Map();
    const events = {
      on: (name, fn) => {
        handlers.set(name, fn);
        return () => handlers.delete(name);
      },
    };
    const delivery = makeDelivery();
    const unsubscribe = subscribeMentorBonusFanout({
      events,
      stored: makeStored(),
      delivery,
      partners: makePartners(),
    });

    assert.equal(typeof unsubscribe, 'function');
    assert.ok(handlers.has(COMPENSATION_EVENTS.MENTOR_BONUS_PAID));
    await handlers.get(COMPENSATION_EVENTS.MENTOR_BONUS_PAID)({
      bonusId: 'bonus-1',
      mentorId: 'mentor-1',
      amount: 1000,
      balanceAfter: 51000,
    });
    assert.equal(delivery.calls.length, 1);
    unsubscribe();
    assert.equal(handlers.size, 0);
  });

  it('builds the wallet-credit email with the new balance', () => {
    const email = buildMentorBonusCredited({
      mentorName: 'Ada Obi',
      memberName: 'Bola Ade',
      amount: 1000,
      balanceAfter: 51000,
    });

    assert.match(email.subject, /1,000/);
    assert.match(email.html, /wallet has been credited/i);
    assert.match(email.html, /51,000/);
    assert.match(email.html, /Bola Ade/);
  });
});
