import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeState, sameState, scoreLead, claimExpiry, prospectWorkedAfter,
  CLAIM_WORK_HOURS, DAILY_CLAIM_LIMIT,
} from './LeadPool.js';

const NOW = new Date('2026-09-18T12:00:00Z').getTime();
const hoursAgo = (h) => new Date(NOW - h * 3600000);

test('normalizeState matches messy variants and aliases FCT/Abuja', () => {
  assert.equal(normalizeState('  Lagos '), 'lagos');
  assert.equal(normalizeState('FCT (Abuja)'), 'fct abuja');
  assert.equal(normalizeState('Abuja'), 'fct abuja');
  assert.equal(normalizeState('FCT'), 'fct abuja');
  assert.equal(normalizeState('Federal Capital Territory'), 'fct abuja');
  assert.equal(normalizeState(''), '');
  assert.ok(sameState('Lagos', ' lagos '));
  assert.ok(sameState('Abuja', 'FCT (Abuja)'));
  assert.ok(!sameState('Lagos', 'Oyo'));
  assert.ok(!sameState('', 'Lagos'));
});

test('hyphenated and dotted FCT spellings all resolve to fct abuja', () => {
  for (const variant of ['FCT - Abuja', 'FCT-Abuja', 'fct - abuja', 'FCT.Abuja', 'FCT_abuja']) {
    assert.equal(normalizeState(variant), 'fct abuja', variant);
  }
  // The wizard dropdown value must match plain pool/server spellings.
  assert.ok(sameState('FCT - Abuja', 'FCT'));
  assert.ok(sameState('FCT - Abuja', 'Abuja'));
  assert.ok(sameState('FCT - Abuja', 'Federal Capital Territory'));
  assert.equal(normalizeState('Nassarawa'), 'nasarawa');
  assert.ok(!sameState('FCT - Abuja', 'Lagos'));
});

test('scoreLead ranks hot, stale and returned leads sanely', () => {
  const hot = scoreLead({
    createdAt: hoursAgo(5),
    name: 'Ada', surname: 'T', phoneNumber: '08031234567', email: 'a@x.test',
    importanceOfPassiveIncome: 'Very important', onlineBusinessTimeDedication: '10 hours weekly',
    comfortWithTech: 'Very comfortable',
  }, { now: NOW });
  assert.ok(hot.score >= 70, `hot scored ${hot.score}`);
  assert.ok(hot.badges.includes('Hot'));
  assert.ok(hot.reasons.length > 0);

  const stale = scoreLead({
    createdAt: new Date(NOW - 60 * 86400000),
    name: 'Old', surname: '', phoneNumber: '08031234567', email: '',
    importanceOfPassiveIncome: 'Not sure',
  }, { now: NOW });
  assert.ok(stale.score < hot.score);

  const returned = scoreLead({
    createdAt: hoursAgo(5),
    name: 'Ada', surname: 'T', phoneNumber: '08031234567', email: 'a@x.test',
    importanceOfPassiveIncome: 'Very important', onlineBusinessTimeDedication: '10 hours',
    comfortWithTech: 'Very comfortable',
  }, { now: NOW, returnCount: 2 });
  assert.ok(returned.score < hot.score);
});

test('claimExpiry secures worked leads and expires idle ones at the window', () => {
  const claimedAt = new Date(NOW - (CLAIM_WORK_HOURS + 1) * 3600000);
  const idle = claimExpiry({ claimedAt }, { now: NOW });
  assert.equal(idle.expirable, true);
  assert.equal(idle.secured, false);

  const fresh = claimExpiry({ claimedAt: new Date(NOW - 3600000) }, { now: NOW });
  assert.equal(fresh.expirable, false);
  assert.ok(fresh.msLeft > 0);

  const worked = claimExpiry({
    claimedAt,
    communications: [{ createdAt: new Date(NOW - 3600000) }],
  }, { now: NOW });
  assert.equal(worked.secured, true);
  assert.equal(worked.expirable, false);

  assert.equal(claimExpiry({}, { now: NOW }).expirable, false);
});

test('prospectWorkedAfter counts comms, stage moves (bookings ride comms)', () => {
  const t0 = NOW - 5000;
  assert.equal(prospectWorkedAfter({ communications: [{ createdAt: new Date(t0 + 1000) }] }, t0), true);
  assert.equal(prospectWorkedAfter({ stageHistory: [{ at: new Date(t0 + 1000) }] }, t0), true);
  assert.equal(prospectWorkedAfter({ communications: [{ createdAt: new Date(t0 - 1000) }] }, t0), false);
  assert.equal(prospectWorkedAfter({}, t0), false);
});

test('windows carry sane defaults', () => {
  assert.equal(CLAIM_WORK_HOURS, 48);
  assert.equal(DAILY_CLAIM_LIMIT, 100);
});
