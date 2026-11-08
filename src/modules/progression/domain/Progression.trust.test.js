import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gate, CONFIRMABLE_KEYS, confirmed, forecastJourney,
} from './Progression.levels.js';

const stamp = () => ({ done: true, confirmedAt: new Date() });

test('training legs require a certificate-backed confirmation, not a self-tap', () => {
  assert.ok(CONFIRMABLE_KEYS.includes('ipo'));
  assert.ok(CONFIRMABLE_KEYS.includes('qsg'));
  assert.ok(CONFIRMABLE_KEYS.includes('smo'));
  assert.ok(CONFIRMABLE_KEYS.includes('leadership'));
  assert.equal(gate('builder', {}, { ipo: { done: true }, qsg: { done: true } })
    .find((r) => r.key === 'ipo').met, false);
  assert.equal(gate('builder', {}, { ipo: stamp(), qsg: stamp() })
    .find((r) => r.key === 'ipo').met, true);
  assert.equal(gate('ambassador', {}, { leadership: { done: true } })
    .find((r) => r.key === 'leadership').met, false);
  assert.equal(gate('ambassador', {}, { leadership: stamp() })
    .find((r) => r.key === 'leadership').met, true);
  assert.equal(confirmed({ done: true }), false);
  assert.equal(confirmed({ done: true, confirmedAt: new Date() }), true);
});

test('leader gate is SMO + 3 personal recruits + 5 active team members', () => {
  const keys = gate('leader', {}, {}).map((r) => r.key);
  assert.deepEqual(keys, ['smo', 'recruits', 'activeTeam']);
  assert.ok(!keys.includes('g8Request'));
  assert.ok(!keys.includes('onboardingSession'));
  assert.ok(!keys.includes('accounts'));
  assert.ok(!keys.includes('maintenance'));

  const base = { recruits: 2, activeDownline: 5 };
  const near = gate('leader', base, { smo: stamp() });
  assert.equal(near.find((r) => r.key === 'recruits').met, false);
  assert.equal(near.find((r) => r.key === 'activeTeam').met, true);

  const met = gate('leader', { recruits: 3, activeDownline: 5 }, { smo: stamp() });
  assert.ok(met.every((r) => r.met));
});

test('ambassador gate is Leadership + 5 personal recruits + 3 downline Leaders', () => {
  const keys = gate('ambassador', {}, {}).map((r) => r.key);
  assert.deepEqual(keys, ['leadership', 'recruits', 'downlineLeaders']);
  assert.ok(!keys.includes('fullTime'));
  assert.ok(!keys.includes('office'));
  assert.ok(!keys.includes('nomination'));

  const near = gate('ambassador', { recruits: 5, downlineLeaders: 2 }, { leadership: stamp() });
  assert.equal(near.find((r) => r.key === 'downlineLeaders').met, false);
  const met = gate('ambassador', { recruits: 5, downlineLeaders: 3 }, { leadership: stamp() });
  assert.ok(met.every((r) => r.met));
});

test('forecastJourney respects the rank-specific recruit target', () => {
  const builder = forecastJourney({ recruits: 0 }, [{ key: 'recruits', target: 1 }], 2);
  assert.equal(builder.remaining, 1);
  const leader = forecastJourney({ recruits: 1 }, [{ key: 'recruits', target: 3 }], 2);
  assert.equal(leader.remaining, 2);
  assert.equal(leader.stalled, false);
  const stalled = forecastJourney({ recruits: 0 }, [{ key: 'recruits', target: 3 }], 0);
  assert.equal(stalled.stalled, true);
  assert.equal(stalled.etaDate, null);
  // Duplication legs get no linear forecast — null, not a fake date.
  assert.equal(forecastJourney({}, [{ key: 'downlineLeaders', target: 3 }], 5), null);
  assert.equal(forecastJourney({}, [], 5), null);
});
