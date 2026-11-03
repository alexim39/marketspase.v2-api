import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCompensationReconcileJob } from './compensation-reconcile.js';

describe('compensation reconcile job', () => {
  it('delegates to the repository and reports the repair totals', async () => {
    const now = new Date('2026-11-10T10:00:00Z');
    let seen = null;
    const result = await runCompensationReconcileJob({
      now,
      repo: {
        reconcileCompensation: async (at) => {
          seen = at;
          return { salesCreated: 2, allocationsAccrued: 1, mentorsAttached: 3, failed: 0 };
        },
      },
    });

    assert.equal(seen, now);
    assert.equal(result.salesCreated, 2);
    assert.equal(result.mentorsAttached, 3);
  });

  it('never throws into the scheduler', async () => {
    const result = await runCompensationReconcileJob({
      repo: { reconcileCompensation: async () => { throw new Error('db down'); } },
    });

    assert.equal(result.failed, 1);
  });
});
