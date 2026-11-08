import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS,
  LEVEL_LABELS,
  LEGACY_LEVEL_MAP,
  normalizeLevel,
  resolveProgression,
} from './Progression.levels.js';

test('the journey ladder uses the same four ranks as compensation', () => {
  assert.deepEqual(LEVELS, ['partner', 'builder', 'leader', 'ambassador']);
  assert.deepEqual(LEVEL_LABELS, {
    partner: 'Partner',
    builder: 'Builder',
    leader: 'Leader',
    ambassador: 'Ambassador',
  });
});

test('legacy stages normalize to the nearest current rank', () => {
  assert.equal(normalizeLevel('prospect'), 'partner');
  assert.equal(normalizeLevel('emerging_active'), 'builder');
  assert.equal(normalizeLevel('qualified_active'), 'builder');
  assert.equal(normalizeLevel('active'), 'builder');
  assert.equal(normalizeLevel('kingsman'), 'leader');
  assert.equal(normalizeLevel('ecl'), 'leader');
  assert.equal(normalizeLevel('cell_leader'), 'ambassador');
  assert.equal(normalizeLevel('g_leader'), 'ambassador');
  assert.equal(normalizeLevel('g8'), 'partner');
  assert.equal(LEGACY_LEVEL_MAP.kingsman, 'leader');
});

test('a legacy g8 value resolves safely instead of crashing', () => {
  const result = resolveProgression({}, {}, 'g8');
  assert.equal(result.level, 'partner');
  assert.equal(result.next, 'builder');
});

test('builder requires IPO, QSG and one personal recruit', () => {
  const confirmed = (done) => ({ done: true, confirmedAt: done ? new Date() : null });
  const missing = resolveProgression({ recruits: 0 }, { ipo: confirmed(true), qsg: confirmed(true) }, 'partner');
  assert.equal(missing.level, 'partner');
  assert.equal(missing.next, 'builder');
  assert.ok(missing.missing.some((r) => r.key === 'recruits'));

  const builder = resolveProgression(
    { recruits: 1, activeDownline: 0 },
    { ipo: confirmed(true), qsg: confirmed(true) },
    'partner',
  );
  assert.equal(builder.level, 'builder');
  assert.equal(builder.next, 'leader');
  assert.deepEqual(builder.missing.map((r) => r.key), ['smo', 'recruits', 'activeTeam']);
});

test('leader requires SMO, three personal recruits and five active team members', () => {
  const confirmed = { done: true, confirmedAt: new Date() };
  const almost = resolveProgression(
    { recruits: 2, activeDownline: 5 },
    { ipo: confirmed, qsg: confirmed, smo: confirmed },
    'builder',
  );
  assert.equal(almost.level, 'builder');
  assert.equal(almost.next, 'leader');
  assert.ok(almost.missing.some((r) => r.key === 'recruits' && r.target === 3));

  const leader = resolveProgression(
    { recruits: 3, activeDownline: 5 },
    { ipo: confirmed, qsg: confirmed, smo: confirmed },
    'builder',
  );
  assert.equal(leader.level, 'leader');
  assert.equal(leader.next, 'ambassador');
});

test('ambassador requires Leadership, five personal recruits and three downline Leaders', () => {
  const confirmed = { done: true, confirmedAt: new Date() };
  const base = { recruits: 5, activeDownline: 5, downlineLeaders: 2 };
  const milestones = { ipo: confirmed, qsg: confirmed, smo: confirmed, leadership: confirmed };
  const almost = resolveProgression(base, milestones, 'leader');
  assert.equal(almost.level, 'leader');
  assert.ok(almost.missing.some((r) => r.key === 'downlineLeaders' && r.target === 3));

  const ambassador = resolveProgression(
    { ...base, downlineLeaders: 3 },
    milestones,
    'leader',
  );
  assert.equal(ambassador.level, 'ambassador');
  assert.equal(ambassador.next, null);
});
