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

test('builder requires IPO, QSG and one recruit', () => {
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
});
