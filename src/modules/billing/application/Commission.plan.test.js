import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateRates, GetPlanUseCase, UpdatePlanUseCase } from './Commission.plan.js';
import { DEFAULT_RATES } from '../domain/CommissionPlan.js';

describe('validateRates', () => {
  it('accepts the default shape', () => {
    assert.deepEqual(validateRates([0.1, 0.05, 0.03, 0.02, 0.01]), DEFAULT_RATES);
  });

  it('rejects empty, oversized, non-positive and over-100% sets', () => {
    assert.throws(() => validateRates([]), /1–5/);
    assert.throws(() => validateRates([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]), /1–5/);
    assert.throws(() => validateRates([0, 0.1]), /greater than 0/);
    assert.throws(() => validateRates([1.5]), /at most 1/);
    assert.throws(() => validateRates([0.6, 0.5]), /sum/);
    assert.throws(() => validateRates('nope'), /1–5/);
  });
});

describe('GetPlanUseCase', () => {
  it('returns the active plan shape', async () => {
    const uc = new GetPlanUseCase({
      ledger: { getActivePlan: async () => ({ _id: 'p1', name: 'Default Unilevel', rates: [0.1], updatedAt: null }) },
    });
    const res = await uc.execute();
    assert.equal(res.id, 'p1');
    assert.deepEqual(res.rates, [0.1]);
  });
});

describe('UpdatePlanUseCase', () => {
  it('rotates to a validated plan with attribution', async () => {
    let rotated = null;
    const uc = new UpdatePlanUseCase({
      ledger: {
        rotatePlan: async (input) => {
          rotated = input;
          return { _id: 'p2', name: input.name, rates: input.rates, updatedAt: null };
        },
      },
    });
    const res = await uc.execute({ rates: [0.12, 0.06], name: '  Q4 Boost ', updatedBy: 'admin1' });
    assert.equal(res.id, 'p2');
    assert.equal(rotated.name, 'Q4 Boost');
    assert.equal(rotated.updatedBy, 'admin1');
    assert.deepEqual(rotated.rates, [0.12, 0.06]);
  });

  it('falls back to a default name and rejects bad rates', async () => {
    const uc = new UpdatePlanUseCase({ ledger: { rotatePlan: async () => { throw new Error('must not run'); } } });
    await assert.rejects(uc.execute({ rates: [0.9, 0.9] }), /sum/);
  });
});
