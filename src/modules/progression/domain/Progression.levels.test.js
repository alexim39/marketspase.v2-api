import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, LEVEL_LABELS, resolveProgression } from './Progression.levels.js';

test('the journey ladder no longer contains a G8 stage', () => {
  assert.equal(LEVELS.includes('g8'), false);
  assert.equal(LEVEL_LABELS.g8, undefined);
  assert.equal(LEVELS.at(-1), 'g_leader');
});

test('a legacy g8 value resolves safely instead of crashing', () => {
  const result = resolveProgression({}, {}, 'g8');
  assert.equal(result.level, 'partner');
});
