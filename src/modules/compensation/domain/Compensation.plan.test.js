import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_RATES,
  RANK_DEPTH,
  commissionAmount,
  depthAllows,
  mentorBonusDays,
  planSummary,
  rankDepth,
  rateForLevel,
} from './Compensation.plan.js';

describe('compensation plan', () => {
  it('uses the approved five-level unilevel rates', () => {
    assert.deepEqual([...LEVEL_RATES], [0.09, 0.045, 0.025, 0.015, 0.01]);
    assert.ok(Math.abs(LEVEL_RATES.reduce((sum, rate) => sum + rate, 0) - 0.185) < 1e-12);
  });

  it('gates depth by the four approved ranks', () => {
    assert.equal(rankDepth('Partner'), 1);
    assert.equal(rankDepth('Builder'), 2);
    assert.equal(rankDepth('Leader'), 3);
    assert.equal(rankDepth('Ambassador'), 5);
    assert.equal(rankDepth('Unknown'), 1);
    assert.deepEqual(RANK_DEPTH, { Partner: 1, Builder: 2, Leader: 3, Ambassador: 5 });
  });

  it('checks whether a rank can earn at a level', () => {
    assert.equal(depthAllows('Partner', 1), true);
    assert.equal(depthAllows('Partner', 2), false);
    assert.equal(depthAllows('Builder', 2), true);
    assert.equal(depthAllows('Builder', 3), false);
    assert.equal(depthAllows('Leader', 3), true);
    assert.equal(depthAllows('Ambassador', 5), true);
  });

  it('computes commission on gross margin, not price', () => {
    const margin = 18430;
    assert.equal(rateForLevel(1), 0.09);
    assert.equal(commissionAmount(margin, 1), 1658.7);
    assert.equal(commissionAmount(margin, 2), 829.35);
    assert.equal(commissionAmount(margin, 3), 460.75);
    assert.equal(commissionAmount(margin, 4), 276.45);
    assert.equal(commissionAmount(margin, 5), 184.3);
    assert.equal(
      [1, 2, 3, 4, 5].reduce((sum, level) => sum + commissionAmount(margin, level), 0),
      3409.55,
    );
  });

  it('rejects bad levels and negative margins', () => {
    assert.equal(rateForLevel(0), 0);
    assert.equal(rateForLevel(6), 0);
    assert.equal(commissionAmount(-500, 1), 0);
  });

  it('exposes the plan and mentor bonus to the UI', () => {
    const plan = planSummary();
    assert.equal(plan.rates.length, 5);
    assert.equal(plan.ranks.find((row) => row.rank === 'Ambassador').depth, 5);
    assert.equal(plan.mentorBonus.amount, 1000);
    assert.equal(plan.mentorBonus.daysAfterActivation, 7);
  });

  it('allows the mentor bonus delay to be configured', () => {
    const previous = process.env.MENTOR_BONUS_DAYS;
    try {
      process.env.MENTOR_BONUS_DAYS = '0';
      assert.equal(mentorBonusDays(), 0);
      assert.equal(planSummary().mentorBonus.daysAfterActivation, 0);

      process.env.MENTOR_BONUS_DAYS = '3';
      assert.equal(mentorBonusDays(), 3);

      process.env.MENTOR_BONUS_DAYS = 'not-a-number';
      assert.equal(mentorBonusDays(), 7);
    } finally {
      if (previous === undefined) delete process.env.MENTOR_BONUS_DAYS;
      else process.env.MENTOR_BONUS_DAYS = previous;
    }
  });
});
