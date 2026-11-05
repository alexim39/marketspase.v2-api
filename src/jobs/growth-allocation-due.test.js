import test from 'node:test';
import assert from 'node:assert/strict';
import { runGrowthAllocationDueJob } from './growth-allocation-due.js';

test('runs partner allocation across active growth campaigns automatically', async () => {
  let input = null;
  let health = null;
  const result = await runGrowthAllocationDueJob({
    allocate: {
      execute: async (value) => {
        input = value;
        return {
          allocated: [{ partner: { id: 'p1' }, campaign: { id: 'c1' } }],
          skipped: { races: 0, failures: 0 },
          context: { campaigns: 1, candidates: 1, remainingCandidates: 0 },
        };
      },
    },
    runs: {
      updateOne: async (_filter, patch) => {
        health = patch;
        return { acknowledged: true };
      },
    },
  });

  assert.deepEqual(input, { campaignId: null, limit: 50 });
  assert.equal(result.allocated.length, 1);
  assert.ok(health);
  assert.equal(health.$set.lastOk, true);
});

test('returns a safe failure instead of throwing into the scheduler', async () => {
  const result = await runGrowthAllocationDueJob({
    allocate: { execute: async () => { throw new Error('boom'); } },
    runs: { updateOne: async () => ({ acknowledged: true }) },
  });

  assert.equal(result.skipped, false);
  assert.equal(result.error, 'boom');
});
