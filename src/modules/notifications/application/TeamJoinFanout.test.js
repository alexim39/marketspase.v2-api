import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVATION_EVENTS } from '../../activation/domain/ActivationEvents.js';
import { buildRecruitAlert } from '../infrastructure/LifecycleMailer.js';
import { TeamJoinFanoutUseCase, subscribeTeamJoinFanout } from './TeamJoinFanout.js';

const sponsor = {
  _id: 'sponsor-1',
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
  partnerOf: 'sponsor-1',
  suspendedAt: null,
};

const makePartners = (overrides = {}) => {
  const rows = new Map([
    ['sponsor-1', sponsor],
    ['member-1', member],
    ...Object.entries(overrides).map(([id, row]) => [id, row]),
  ]);
  return {
    findById: async (id) => rows.get(String(id)) ?? null,
  };
};

const makeStored = (existing = null) => ({
  findByKey: async () => existing,
});

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

describe('TeamJoinFanoutUseCase', () => {
  it('notifies the sponsor when a referred member signs up', async () => {
    const delivery = makeDelivery();
    const fanout = new TeamJoinFanoutUseCase({
      stored: makeStored(),
      delivery,
      partners: makePartners(),
    });

    const result = await fanout.notifyReferral({ partnerId: 'member-1', memberName: 'Bola Ade' });

    assert.equal(result.status, 'notified');
    assert.equal(delivery.calls.length, 1);
    const call = delivery.calls[0];
    assert.equal(call.recipientId, 'sponsor-1');
    assert.equal(call.contact.email, 'ada@example.com');
    assert.equal(call.item.category, 'team');
    assert.equal(call.item.priority, 'high');
    assert.equal(call.item.key, 'team-join:referral:member-1');
    assert.equal(call.item.link, '/dashboard/mentorship/partners/my-partners');
    assert.match(call.item.title, /joined your team/i);
    assert.match(call.item.body, /Bola Ade/);
    assert.match(call.email.subject, /joined your team/i);
    assert.equal(call.emailPolicy, 'force');
  });

  it('skips a referral with no sponsor', async () => {
    const delivery = makeDelivery();
    const fanout = new TeamJoinFanoutUseCase({
      stored: makeStored(),
      delivery,
      partners: makePartners({ 'member-1': { ...member, partnerOf: null } }),
    });

    const result = await fanout.notifyReferral({ partnerId: 'member-1' });

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'no-sponsor');
    assert.equal(delivery.calls.length, 0);
  });

  it('notifies the campaign owner when a member is allocated', async () => {
    const delivery = makeDelivery();
    const fanout = new TeamJoinFanoutUseCase({
      stored: makeStored(),
      delivery,
      partners: makePartners(),
    });

    const result = await fanout.notifyAllocation({
      partnerId: 'member-1',
      ownerId: 'sponsor-1',
      campaignId: 'campaign-1',
      campaignName: 'Lagos Growth',
      allocationId: 'allocation-1',
    });

    assert.equal(result.status, 'notified');
    const call = delivery.calls[0];
    assert.equal(call.item.key, 'team-join:allocation:allocation-1');
    assert.equal(call.item.link, '/dashboard/network/tree');
    assert.match(call.item.title, /added to your team/i);
    assert.match(call.item.body, /Lagos Growth/);
    assert.match(call.email.subject, /allocated to your team/i);
    assert.match(call.email.html, /Lagos Growth/);
  });

  it('notifies the owner on an admin override with a distinct key', async () => {
    const delivery = makeDelivery();
    const fanout = new TeamJoinFanoutUseCase({
      stored: makeStored(),
      delivery,
      partners: makePartners(),
    });

    const result = await fanout.notifyAllocation({
      partnerId: 'member-1',
      ownerId: 'sponsor-1',
      allocationId: 'allocation-2',
      source: 'override',
    });

    assert.equal(result.status, 'notified');
    assert.equal(delivery.calls[0].item.key, 'team-join:override:allocation-2');
    assert.match(delivery.calls[0].item.body, /placed in your team by MarketSpase/);
  });

  it('does not send a duplicate alert', async () => {
    const delivery = makeDelivery();
    const fanout = new TeamJoinFanoutUseCase({
      stored: makeStored({ id: 'existing' }),
      delivery,
      partners: makePartners(),
    });

    const result = await fanout.notifyReferral({ partnerId: 'member-1' });

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'already-sent');
    assert.equal(delivery.calls.length, 0);
  });

  it('does not notify a suspended sponsor', async () => {
    const delivery = makeDelivery();
    const fanout = new TeamJoinFanoutUseCase({
      stored: makeStored(),
      delivery,
      partners: makePartners({
        'sponsor-1': { ...sponsor, suspendedAt: new Date() },
      }),
    });

    const result = await fanout.notifyReferral({ partnerId: 'member-1' });

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'sponsor-suspended');
    assert.equal(delivery.calls.length, 0);
  });

  it('returns a failed result instead of throwing when delivery breaks', async () => {
    const fanout = new TeamJoinFanoutUseCase({
      stored: makeStored(),
      delivery: makeDelivery({ throws: true }),
      partners: makePartners(),
    });

    const result = await fanout.notifyReferral({ partnerId: 'member-1' });

    assert.equal(result.status, 'failed');
    assert.match(result.error, /mail provider down/);
  });

  it('subscribes to referrals, allocations and overrides', async () => {
    const handlers = new Map();
    const events = {
      on: (name, fn) => {
        handlers.set(name, fn);
        return () => handlers.delete(name);
      },
    };
    const delivery = makeDelivery();
    const unsubscribe = subscribeTeamJoinFanout({
      events,
      stored: makeStored(),
      delivery,
      partners: makePartners(),
    });

    assert.equal(typeof unsubscribe, 'function');
    assert.ok(handlers.has(ACTIVATION_EVENTS.MEMBER_SIGNED_UP));
    assert.ok(handlers.has('partner.allocated'));
    assert.ok(handlers.has('campaign.allocation.overridden'));

    await handlers.get(ACTIVATION_EVENTS.MEMBER_SIGNED_UP)({ partnerId: 'member-1' });
    assert.equal(delivery.calls.length, 1);

    unsubscribe();
    assert.equal(handlers.size, 0);
  });

  it('builds referral and allocation email copy from the same template', () => {
    const referral = buildRecruitAlert({ memberName: 'Bola Ade', uplineName: 'Ada Obi' });
    const allocation = buildRecruitAlert({
      memberName: 'Bola Ade',
      uplineName: 'Ada Obi',
      source: 'allocation',
      campaignName: 'Lagos Growth',
    });

    assert.match(referral.subject, /joined your team/i);
    assert.match(referral.html, /referral code/);
    assert.match(allocation.subject, /allocated to your team/i);
    assert.match(allocation.html, /Lagos Growth/);
  });
});
