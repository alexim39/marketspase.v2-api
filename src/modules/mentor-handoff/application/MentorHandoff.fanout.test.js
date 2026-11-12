import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVATION_EVENTS } from '../../activation/domain/ActivationEvents.js';
import {
  MentorHandoffFanoutUseCase,
  subscribeMentorHandoffFanout,
} from './MentorHandoff.fanout.js';

const mentorId = 'a'.repeat(24);
const memberId = 'b'.repeat(24);
const otherMentorId = 'd'.repeat(24);

const makePartners = (member = {}, mentor = {}) => {
  const rows = new Map([
    [mentorId, {
      _id: mentorId,
      name: 'Ada',
      surname: 'Obi',
      username: 'ada',
      ...mentor,
    }],
    [otherMentorId, {
      _id: otherMentorId,
      name: 'Chidi',
      surname: 'Eze',
      username: 'chidi',
    }],
    [memberId, {
      _id: memberId,
      name: 'Bola',
      surname: 'Ade',
      username: 'bola',
      partnerOf: mentorId,
      createdAt: new Date('2026-11-01T09:00:00Z'),
      ...member,
    }],
  ]);
  return { findById: async (id) => rows.get(String(id)) ?? null };
};

const makeHandoffs = ({ existing = null } = {}) => {
  const calls = { ensure: [], update: [] };
  return {
    calls,
    ensureTask: async (input) => {
      calls.ensure.push(input);
      return { id: 'handoff-1', ...input };
    },
    updateFromActivation: async (input) => {
      calls.update.push(input);
      return existing === false ? null : { id: 'handoff-1', ...input };
    },
  };
};

describe('MentorHandoffFanoutUseCase', () => {
  it('creates a new-member task when a referred member signs up', async () => {
    const handoffs = makeHandoffs();
    const fanout = new MentorHandoffFanoutUseCase({ handoffs, partners: makePartners() });

    const result = await fanout.onReferral({ partnerId: memberId });

    assert.equal(result.status, 'created');
    assert.equal(handoffs.calls.ensure.length, 1);
    assert.equal(handoffs.calls.ensure[0].mentorId, mentorId);
    assert.equal(handoffs.calls.ensure[0].source, 'referral');
    assert.equal(handoffs.calls.ensure[0].preference, 'in_app');
    assert.deepEqual(handoffs.calls.ensure[0].joinedAt, new Date('2026-11-01T09:00:00Z'));
  });

  it('creates a task when a campaign allocates a member to an owner', async () => {
    const handoffs = makeHandoffs();
    const fanout = new MentorHandoffFanoutUseCase({ handoffs, partners: makePartners() });

    const result = await fanout.onAllocated({
      partnerId: memberId,
      ownerId: otherMentorId,
      campaignId: 'campaign-1',
    });

    assert.equal(result.status, 'created');
    assert.equal(handoffs.calls.ensure[0].mentorId, otherMentorId);
    assert.equal(handoffs.calls.ensure[0].source, 'allocation');
  });

  it('distinguishes an admin override task from an allocation', async () => {
    const handoffs = makeHandoffs();
    const fanout = new MentorHandoffFanoutUseCase({ handoffs, partners: makePartners() });

    await fanout.onAllocated({ partnerId: memberId, ownerId: otherMentorId }, 'override');

    assert.equal(handoffs.calls.ensure[0].source, 'override');
  });

  it('skips members with no mentor instead of creating an orphan task', async () => {
    const handoffs = makeHandoffs();
    const fanout = new MentorHandoffFanoutUseCase({
      handoffs,
      partners: makePartners({ partnerOf: null }),
    });

    const result = await fanout.onReferral({ partnerId: memberId });

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'no-mentor');
    assert.equal(handoffs.calls.ensure.length, 0);
  });

  it('snapshots the activation preference and consent onto the existing task', async () => {
    const handoffs = makeHandoffs();
    const fanout = new MentorHandoffFanoutUseCase({
      handoffs,
      partners: makePartners({ mentorContactPreference: 'email', mentorContactConsentAt: null }),
    });

    const result = await fanout.onActivated({
      partnerId: memberId,
      mentorContactPreference: 'email',
      mentorContactConsentAt: new Date('2026-11-12T10:00:00Z'),
      activatedAt: new Date('2026-11-12T10:00:00Z'),
    });

    assert.equal(result.status, 'updated');
    assert.equal(handoffs.calls.update[0].preference, 'email');
    assert.deepEqual(
      handoffs.calls.update[0].consentAt,
      new Date('2026-11-12T10:00:00Z'),
    );
    assert.deepEqual(
      handoffs.calls.update[0].activatedAt,
      new Date('2026-11-12T10:00:00Z'),
    );
  });

  it('creates the task at activation for legacy members with no signup task', async () => {
    const handoffs = makeHandoffs({ existing: false });
    const fanout = new MentorHandoffFanoutUseCase({ handoffs, partners: makePartners() });

    const result = await fanout.onActivated({
      partnerId: memberId,
      mentorContactPreference: 'phone',
      mentorContactConsentAt: new Date('2026-11-12T10:00:00Z'),
    });

    assert.equal(result.status, 'skipped');
    assert.equal(handoffs.calls.ensure.length, 1);
    assert.equal(handoffs.calls.update.at(-1).preference, 'phone');
  });

  it('does nothing for an unknown member', async () => {
    const handoffs = makeHandoffs();
    const fanout = new MentorHandoffFanoutUseCase({ handoffs, partners: makePartners() });

    const result = await fanout.onActivated({ partnerId: 'e'.repeat(24) });

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'member-not-found');
  });

  it('subscribes to signup, allocation, override and activation events', async () => {
    const handlers = new Map();
    const events = {
      on: (name, fn) => {
        handlers.set(name, fn);
        return () => handlers.delete(name);
      },
    };
    const handoffs = makeHandoffs();
    const unsubscribe = subscribeMentorHandoffFanout({
      events,
      handoffs,
      partners: makePartners(),
    });

    assert.equal(typeof unsubscribe, 'function');
    assert.ok(handlers.has(ACTIVATION_EVENTS.MEMBER_SIGNED_UP));
    assert.ok(handlers.has('partner.allocated'));
    assert.ok(handlers.has('campaign.allocation.overridden'));
    assert.ok(handlers.has('partner.activated'));

    await handlers.get('partner.allocated')({ partnerId: memberId, ownerId: mentorId });
    assert.equal(handoffs.calls.ensure[0].source, 'allocation');

    unsubscribe();
    assert.equal(handlers.size, 0);
  });
});
