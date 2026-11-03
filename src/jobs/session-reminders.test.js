import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionRemindersJob,
  dueLegs,
  reminderCopy,
  runSessionRemindersJob,
  sessionStartOf,
} from './session-reminders.js';

const NOW = new Date('2026-10-07T10:00:00');

test('sessionStartOf combines date + HH:MM, rejects garbage', () => {
  const at = sessionStartOf({ consultDate: '2026-10-08T00:00:00.000Z', consultTime: '14:30' });
  assert.ok(at instanceof Date);
  assert.equal(at.getHours(), 14);
  assert.equal(at.getMinutes(), 30);
  assert.equal(sessionStartOf({ consultDate: 'nope', consultTime: '14:30' }), null);
  assert.equal(sessionStartOf({ consultDate: '2026-10-08', consultTime: '99:99' }), null);
  assert.equal(sessionStartOf({ consultDate: '2026-10-08' }), null);
});

test('dueLegs picks the 24h and 1h windows', () => {
  const h24 = new Date(NOW.getTime() + 24 * 3600000);
  assert.deepEqual(dueLegs(h24, NOW), { h24: true, h1: false });
  const h1 = new Date(NOW.getTime() + 30 * 60000);
  assert.deepEqual(dueLegs(h1, NOW), { h24: false, h1: true });
  const past = new Date(NOW.getTime() - 3600000);
  assert.deepEqual(dueLegs(past, NOW), { h24: false, h1: false });
  const far = new Date(NOW.getTime() + 72 * 3600000);
  assert.deepEqual(dueLegs(far, NOW), { h24: false, h1: false });
});

const fakeJob = (bookings, { smsFail = false } = {}) => {
  const smsSent = [];
  const pushes = [];
  const notified = [];
  const stamped = [];
  return {
    deps: {
      now: NOW,
      bookings: {
        // Emulates the Mongo status filter (active sessions only).
        find: (filter) => {
          const allowed = filter?.status?.$in ?? null;
          const rows = allowed
            ? bookings.filter((b) => allowed.includes(b.status))
            : bookings;
          const chain = {
            select: () => chain,
            sort: () => chain,
            limit: () => chain,
            lean: async () => rows,
          };
          return chain;
        },
        updateOne: async (filter, update) => {
          // Atomic null-check guard emulation.
          const row = bookings.find((b) => String(b._id) === String(filter._id));
          const field = Object.keys(update.$set)[0];
          if (row && row[field] == null) {
            row[field] = update.$set[field];
            stamped.push(`${row._id}:${field}`);
            return { modifiedCount: 1 };
          }
          return { modifiedCount: 0 };
        },
      },
      partners: {
        findOne: () => ({
          select: () => ({
            lean: async () => ({ _id: 'owner1', name: 'Coach', surname: 'K', username: 'coachk', phone: '08030000000' }),
          }),
        }),
      },
      sms: {
        send: async (m) => {
          if (smsFail) throw new Error('gateway down');
          smsSent.push(m);
          return { providerId: 'x' };
        },
      },
      push: { send: async (m) => { pushes.push(m); return { delivered: true }; } },
      notify: { execute: async (m) => { notified.push(m); return { id: 'n1' }; } },
      stored: { listSubscriptions: async () => [{ endpoint: 'e', keys: {} }], pruneSubscription: async () => ({}) },
    },
    smsSent,
    pushes,
    notified,
    stamped,
  };
};

const booking = (over = {}) => ({
  _id: 'b1',
  username: 'coachk',
  name: 'Ada',
  surname: 'T',
  phone: '08031111111',
  reason: 'Product Presentation',
  consultDate: new Date(NOW.getTime() + 24 * 3600000),
  consultTime: '10:00',
  status: 'Scheduled',
  reminded24hAt: null,
  reminded1hAt: null,
  ...over,
});

test('24h session sends one SMS + in-app + push, stamped once', async () => {
  const f = fakeJob([booking()]);
  const res = await runSessionRemindersJob(f.deps);
  assert.equal(res.sent.h24, 1);
  assert.equal(f.smsSent.length, 1);
  assert.match(f.smsSent[0].body, /tomorrow/);
  assert.equal(f.notified.length, 1);
  assert.equal(f.pushes.length, 1);
  assert.deepEqual(f.stamped, ['b1:reminded24hAt']);
});

test('already-stamped legs never resend', async () => {
  const f = fakeJob([booking({ reminded24hAt: NOW })]);
  const res = await runSessionRemindersJob(f.deps);
  assert.equal(res.sent.h24, 0);
  assert.equal(f.smsSent.length, 0);
});

test('cancelled sessions are skipped', async () => {
  const f = fakeJob([booking({ status: 'Cancelled' })]);
  const res = await runSessionRemindersJob(f.deps);
  assert.equal(res.sent.h24 + res.sent.h1, 0);
  assert.equal(f.smsSent.length, 0);
});

test('1h session uses the urgent copy', async () => {
  const f = fakeJob([booking({
    _id: 'b2',
    consultDate: new Date(NOW),
    consultTime: '10:30',
  })]);
  const res = await runSessionRemindersJob(f.deps);
  assert.equal(res.sent.h1, 1);
  assert.match(f.smsSent[0].body, /about an hour/);
  assert.deepEqual(f.stamped, ['b2:reminded1hAt']);
});

test('SMS failure skips without stamping (retries next run)', async () => {
  const f = fakeJob([booking()], { smsFail: true });
  const res = await runSessionRemindersJob(f.deps);
  assert.equal(res.sent.h24, 0);
  assert.deepEqual(f.stamped, []);
  assert.equal(f.notified.length, 0);
});

test('reminderCopy shapes both legs', () => {
  const c24 = reminderCopy('h24', { prospectName: 'Ada', ownerName: 'Coach', reason: 'Demo', when: 'Thu 10:00' });
  assert.match(c24.sms, /tomorrow/);
  const c1 = reminderCopy('h1', { prospectName: 'Ada', ownerName: 'Coach', reason: 'Demo', when: '10:00' });
  assert.match(c1.title, /hour/);
  void buildSessionRemindersJob;
});
