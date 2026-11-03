import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpireStaleClaimsUseCase } from './Prospect.expiry.js';

const NOW = new Date('2026-09-18T12:00:00Z').getTime();
const hoursAgo = (h) => new Date(NOW - h * 3600000);

const row = (over = {}) => ({
  _id: `c${Math.random().toString(36).slice(2, 7)}`,
  partnerId: 'p1',
  prospectName: 'Ada',
  prospectSurname: 'T',
  claimedAt: hoursAgo(50),
  status: { stage: 'New' },
  communications: [],
  stageHistory: [],
  ...over,
});

const fakeClaims = (rows = []) => ({
  updated: [],
  find: () => {
    const chain = {
      sort: () => chain,
      limit: (n) => ({ lean: async () => rows.slice(0, n).map((r) => ({ ...r })) }),
    };
    return chain;
  },
  updateOne: async (filter, update) => {
    const r = rows.find((x) => String(x._id) === String(filter._id));
    if (r) Object.assign(r, update.$set ?? {});
    return { modifiedCount: r ? 1 : 0 };
  },
});

test('warns inside the window, expires past it, spares worked + converted', async () => {
  const idleOld = row({ _id: 'old' }); // 50h, no activity → expire
  const idleWarn = row({ _id: 'warn', claimedAt: hoursAgo(40) }); // 8h left → warn
  const worked = row({ _id: 'worked', communications: [{ createdAt: hoursAgo(5) }] });
  const converted = row({ _id: 'conv', status: { stage: 'Converted' } });
  const fresh = row({ _id: 'fresh', claimedAt: hoursAgo(5) });
  const claims = fakeClaims([idleOld, idleWarn, worked, converted, fresh]);
  const released = [];
  const notices = [];
  const uc = new ExpireStaleClaimsUseCase({
    claims,
    release: { execute: async ({ prospectId }) => { released.push(prospectId); return { released: true }; } },
    notify: async (n) => { notices.push(n); },
    now: () => NOW,
    workHours: 48,
    warningHours: 12,
  });
  const res = await uc.execute();
  assert.equal(res.checked, 4); // converted skipped entirely
  assert.deepEqual(released, ['old']);
  assert.equal(res.expired, 1);
  assert.equal(res.secured, 1);
  assert.equal(res.warned, 1);
  const kinds = Object.fromEntries(notices.map((n) => [n.kind, n]));
  assert.equal(kinds.expired.leadName, 'Ada T');
  assert.ok(kinds.warning.hoursLeft >= 1 && kinds.warning.hoursLeft <= 12);
  assert.ok(idleWarn.claimWarningAt);
});

test('never warns twice for the same claim', async () => {
  const already = row({ _id: 'w', claimedAt: hoursAgo(40), claimWarningAt: hoursAgo(2) });
  const claims = fakeClaims([already]);
  const notices = [];
  const uc = new ExpireStaleClaimsUseCase({
    claims,
    release: { execute: async () => ({ released: true }) },
    notify: async (n) => { notices.push(n); },
    now: () => NOW,
    workHours: 48,
    warningHours: 12,
  });
  const res = await uc.execute();
  assert.equal(res.warned, 0);
  assert.equal(notices.length, 0);
});

test('release failures are collected, never thrown', async () => {
  const bad = row({ _id: 'bad' });
  const claims = fakeClaims([bad]);
  const uc = new ExpireStaleClaimsUseCase({
    claims,
    release: { execute: async () => { throw new Error('db down'); } },
    now: () => NOW,
    workHours: 48,
    warningHours: 12,
  });
  const res = await uc.execute();
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].id, 'bad');
});
