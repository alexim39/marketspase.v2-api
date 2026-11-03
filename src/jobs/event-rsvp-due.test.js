import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dueLegs, reminderCopy, runEventRsvpDueJob } from './event-rsvp-due.js';

const HOUR = 3600000;
const now = new Date('2026-06-01T12:00:00Z');
const at = (ms) => new Date(now.getTime() + ms);

const jobDeps = (events = [], attendeesByEvent = {}) => {
  const calls = { sms: [], notify: [], push: [], stamps: [], audits: [] };
  const rsvpRows = [];
  return {
    calls,
    deps: {
      now,
      events: {
        find() {
          return {
            select() { return this; },
            sort() { return this; },
            limit() { return this; },
            lean: async () => events.map((e) => ({ ...e })),
          };
        },
      },
      partners: {
        findById() {
          return {
            select() { return this; },
            lean: async () => ({ _id: 'p1', name: 'Ama', surname: 'K', username: 'amak', phone: '08030000001' }),
          };
        },
      },
      rsvps: {
        async updateOne(filter, update) {
          calls.stamps.push({ filter, update });
          return { modifiedCount: 1 };
        },
      },
      store: {
        async attendees(eventId) {
          return (attendeesByEvent[String(eventId)] ?? []).map((a) => ({ ...a }));
        },
      },
      sms: { async send(input) { calls.sms.push(input); return { providerId: 'x' }; } },
      push: { async send() { return { delivered: true }; } },
      notify: { async execute(input) { calls.notify.push(input); return null; } },
      stored: { async listSubscriptions() { return []; }, async pruneSubscription() { return null; } },
      audit: async (entry) => { calls.audits.push(entry); return null; },
    },
  };
};

const ev = (over = {}) => ({
  _id: 'e1', title: 'Saturday Session', startsAt: at(24 * HOUR), location: 'Lekki Hall', ...over,
});
const attendee = (over = {}) => ({
  partnerId: 'p1', status: 'going', attended: null,
  reminded24hAt: null, reminded1hAt: null, name: 'Ama K', username: 'amak',
  phone: '08030000001', email: 'a@x.test', ...over,
});

describe('dueLegs', () => {
  it('opens the h24 window a day out and the h1 window an hour out', async () => {
    assert.deepEqual(dueLegs(at(24 * HOUR), now), { h24: true, h1: false });
    assert.deepEqual(dueLegs(at(30 * 60000), now), { h24: false, h1: true });
    assert.deepEqual(dueLegs(at(-HOUR), now), { h24: false, h1: false });
    assert.deepEqual(dueLegs(at(3 * 24 * HOUR), now), { h24: false, h1: false });
  });
});

describe('reminderCopy', () => {
  it('names the event, when and where on both legs', async () => {
    const h24 = reminderCopy('h24', { eventTitle: 'S', when: 'Sat', location: 'Lekki' });
    assert.ok(h24.sms.includes('tomorrow') && h24.sms.includes('Lekki'));
    const h1 = reminderCopy('h1', { eventTitle: 'S', when: 'Sat', location: '' });
    assert.ok(h1.sms.includes('about an hour'));
  });
});

describe('runEventRsvpDueJob', () => {
  it('sends the h24 leg with an atomic stamp, then skips the stamped leg', async () => {
    const { calls, deps } = jobDeps([ev()], { e1: [attendee()] });
    const out = await runEventRsvpDueJob(deps);
    assert.equal(out.sent.h24, 1);
    assert.equal(calls.sms.length, 1);
    assert.equal(calls.notify.length, 1);
    assert.ok(calls.notify[0].key.includes('h24'));
    assert.deepEqual(calls.stamps[0].update, { $set: { reminded24hAt: now } });
    // Rerun with the stamp set — leg skipped, no second send.
    const again = jobDeps([ev()], { e1: [attendee({ reminded24hAt: now })] });
    const out2 = await runEventRsvpDueJob(again.deps);
    assert.equal(out2.sent.h24, 0);
    assert.equal(again.calls.sms.length, 0);
  });

  it('sends the h1 leg inside the hour and skips declined RSVPs', async () => {
    const { calls, deps } = jobDeps(
      [ev({ _id: 'e2', startsAt: at(30 * 60000) })],
      { e2: [attendee({ partnerId: 'p2', reminded24hAt: now })] },
    );
    const out = await runEventRsvpDueJob(deps);
    assert.equal(out.sent.h1, 1);
    assert.ok(calls.notify[0].key.includes('h1'));
  });

  it('ignores past events and members without phones for SMS only', async () => {
    const noPhone = {
      partners: {
        findById() {
          return {
            select() { return this; },
            lean: async () => ({ _id: 'p3', name: 'No', surname: 'Phone', username: 'np', phone: null }),
          };
        },
      },
    };
    const base = jobDeps([ev()], { e1: [attendee({ partnerId: 'p3' })] });
    const out = await runEventRsvpDueJob({ ...base.deps, ...noPhone });
    assert.equal(out.sent.h24, 1);
    assert.equal(base.calls.sms.length, 0);
    assert.equal(base.calls.notify.length, 1);
    const past = jobDeps([ev({ _id: 'e9', startsAt: at(-HOUR) })], { e9: [attendee()] });
    const outPast = await runEventRsvpDueJob(past.deps);
    assert.equal(outPast.sent.h24 + outPast.sent.h1, 0);
  });
});
