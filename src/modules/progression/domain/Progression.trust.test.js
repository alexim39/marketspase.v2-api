import test from 'node:test';
import assert from 'node:assert/strict';
import { gate, CONFIRMABLE_KEYS, confirmed, forecastJourney } from './Progression.levels.js';

test('trust legs require upline confirmation, not self-tap', () => {
  assert.ok(CONFIRMABLE_KEYS.includes('fullTime'));
  assert.ok(CONFIRMABLE_KEYS.includes('office'));
  assert.ok(CONFIRMABLE_KEYS.includes('onboardingSession'));
  const bare = { fullTime: { done: true }, office: { done: true }, onboardingSession: { done: true } };
  assert.equal(gate('active', {}, bare).find((r) => r.key === 'onboardingSession').met, false);
  assert.equal(gate('ecl', { kingsmen: 5 }, bare).find((r) => r.key === 'fullTime').met, false);
  const ok = {
    fullTime: { done: true, confirmedAt: new Date() },
    office: { done: true, confirmedAt: new Date() },
    onboardingSession: { done: true, confirmedAt: new Date() },
  };
  assert.equal(gate('active', {}, ok).find((r) => r.key === 'onboardingSession').met, true);
  assert.equal(confirmed({ done: true }), false);
  assert.equal(confirmed({ done: true, confirmedAt: new Date() }), true);
});

test('DTC accounts need 3 refs AND upline confirmation', () => {
  assert.ok(CONFIRMABLE_KEYS.includes('accounts'));
  assert.ok(CONFIRMABLE_KEYS.includes('maintenance'));
  const sig = { activeDownline: 5, maintenanceOk: true };
  const smo = { done: true, confirmedAt: new Date() };
  // Bare count with no confirmation must NOT open the gate (Phase 1 fix).
  assert.equal(gate('kingsman', sig, { accounts: { count: 3 }, smo }).find((r) => r.key === 'accounts').met, false);
  assert.equal(gate('kingsman', sig, { accounts: { count: 3, done: true }, smo }).find((r) => r.key === 'accounts').met, false);
  assert.equal(
    gate('kingsman', sig, { accounts: { count: 3, done: true, confirmedAt: new Date() }, smo }).find((r) => r.key === 'accounts').met,
    true,
  );
  // Fewer than 3 stays shut even when confirmed.
  assert.equal(
    gate('kingsman', sig, { accounts: { count: 2, done: true, confirmedAt: new Date() }, smo }).find((r) => r.key === 'accounts').met,
    false,
  );
});

test('forecastJourney projects ETA from 30d pace, honest on stall', () => {
  const one = forecastJourney({ recruits: 0 }, [{ key: 'recruits' }], 2, new Date('2026-10-07T00:00:00Z'));
  assert.equal(one.remaining, 1);
  assert.equal(one.stalled, false);
  assert.ok(one.weeksOut >= 1);
  assert.ok(one.etaDate);
  assert.match(one.label, /at current 30-day pace/);
  const stalled = forecastJourney({ recruits: 0 }, [{ key: 'recruits' }], 0);
  assert.equal(stalled.stalled, true);
  assert.equal(stalled.etaDate, null);
  assert.match(stalled.label, /stalled/);
  // Duplication legs get no linear forecast — null, not a fake date.
  assert.equal(forecastJourney({}, [{ key: 'kingsmen' }, { key: 'office' }], 5), null);
  assert.equal(forecastJourney({}, [], 5), null);
});

test('maintenance passes via shop volume OR confirmed DTC receipt', () => {
  const base = { accounts: { count: 3, done: true, confirmedAt: new Date() }, smo: { done: true, confirmedAt: new Date() } };
  assert.equal(gate('kingsman', { activeDownline: 5, maintenanceOk: true }, base).find((r) => r.key === 'maintenance').met, true);
  assert.equal(
    gate('kingsman', { activeDownline: 5, maintenanceOk: false }, { ...base, maintenance: { done: true, confirmedAt: new Date(), ref: 'ORD-1' } }).find((r) => r.key === 'maintenance').met,
    true,
  );
  assert.equal(gate('kingsman', { activeDownline: 5, maintenanceOk: false }, base).find((r) => r.key === 'maintenance').met, false);
});
