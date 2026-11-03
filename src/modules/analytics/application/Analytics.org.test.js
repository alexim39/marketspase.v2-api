import test from 'node:test';
import assert from 'node:assert/strict';
import { GetOrgFunnelUseCase, GetRetentionUseCase } from './Analytics.usecases.js';

test('org funnel shapes distribution into funnel math', async () => {
  const uc = new GetOrgFunnelUseCase({
    prospects: {
      orgStageDistribution: async () => ({ New: 10, Contacted: 6, Converted: 2 }),
    },
  });
  const res = await uc.execute({ days: 30 });
  assert.equal(res.days, 30);
  assert.equal(res.entered, 10);
  assert.equal(res.converted, 2);
  assert.equal(res.overallRate, 20);
});

test('retention rolls cohorts into rank distributions', async () => {
  const uc = new GetRetentionUseCase({
    partners: {
      signupCohorts: async () => [
        { month: '2026-08', ids: ['a', 'b', 'c'], capped: false },
        { month: '2026-09', ids: [], capped: false },
      ],
    },
    progress: {
      levelsFor: async () => ({ a: 'partner', b: 'kingsman', c: 'active' }),
    },
  });
  const res = await uc.execute({ months: 6 });
  assert.equal(res.cohorts.length, 2);
  const aug = res.cohorts[0];
  assert.equal(aug.cohort, 3);
  assert.equal(aug.ranked, 3);
  assert.equal(aug.advanced, 2);
  assert.equal(aug.distribution.kingsman, 1);
  assert.equal(res.cohorts[1].advancedRate, null);
});

test('retention degrades without a progress store', async () => {
  const uc = new GetRetentionUseCase({
    partners: { signupCohorts: async () => [{ month: '2026-09', ids: ['a'], capped: false }] },
    progress: null,
  });
  const res = await uc.execute({});
  assert.equal(res.cohorts[0].ranked, 0);
});
