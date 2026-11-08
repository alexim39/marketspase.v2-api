import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { demotionConfig, evaluateDemotion, nextLowerLevel } from './DemotionPolicy.js';

const config = { enabled: true, graceDays: 30, cycles: 2, maxSteps: 1 };
const base = {
  level: 'leader',
  lastPromotionAt: new Date('2026-01-01T00:00:00Z'),
  misses: 0,
  maintenanceOk: false,
  now: new Date('2026-03-01T00:00:00Z'),
  config,
};

describe('demotion policy', () => {
  it('steps one rank at a time and never below Partner', () => {
    assert.equal(nextLowerLevel('ambassador'), 'leader');
    assert.equal(nextLowerLevel('leader'), 'builder');
    assert.equal(nextLowerLevel('builder'), 'partner');
    assert.equal(nextLowerLevel('partner'), 'partner');
  });

  it('is disabled by config and never demotes Partner', () => {
    assert.equal(evaluateDemotion({ ...base, config: { ...config, enabled: false } }).action, 'skip');
    assert.equal(evaluateDemotion({ ...base, level: 'partner' }).action, 'skip');
  });

  it('protects a newly promoted member during the grace window', () => {
    const result = evaluateDemotion({
      ...base,
      lastPromotionAt: new Date('2026-02-20T00:00:00Z'),
    });
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'grace');
  });

  it('resets misses when maintenance recovers', () => {
    const result = evaluateDemotion({ ...base, misses: 1, maintenanceOk: true });
    assert.equal(result.action, 'reset');
    assert.equal(result.misses, 0);
  });

  it('increments first, then demotes after consecutive failures', () => {
    const first = evaluateDemotion(base);
    assert.equal(first.action, 'increment');
    assert.equal(first.misses, 1);

    const second = evaluateDemotion({ ...base, misses: 1 });
    assert.equal(second.action, 'demote');
    assert.equal(second.nextLevel, 'builder');
    assert.equal(second.fromLabel, 'Leader');
    assert.equal(second.toLabel, 'Builder');
  });

  it('reads env config with safe defaults', () => {
    const cfg = demotionConfig({ DEMOTION_CYCLES: '3', DEMOTION_GRACE_DAYS: '14' });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.cycles, 3);
    assert.equal(cfg.graceDays, 14);
    assert.equal(demotionConfig({ PROGRESSION_DEMOTION_ENABLED: '0' }).enabled, false);
  });
});
