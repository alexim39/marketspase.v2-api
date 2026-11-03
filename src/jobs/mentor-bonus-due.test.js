import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runMentorBonusDueJob } from './mentor-bonus-due.js';

describe('mentor bonus due job', () => {
  it('delegates to the repository and reports the batch', async () => {
    const now = new Date('2026-11-10T10:00:00Z');
    let seen = null;
    const result = await runMentorBonusDueJob({
      now,
      repo: {
        runMentorBonuses: async (at) => {
          seen = at;
          return { checked: 3, paid: 2, forfeited: 1, held: 0, failed: 0 };
        },
      },
    });

    assert.equal(seen, now);
    assert.equal(result.paid, 2);
    assert.equal(result.checked, 3);
  });

  it('never throws into the scheduler', async () => {
    const result = await runMentorBonusDueJob({
      repo: { runMentorBonuses: async () => { throw new Error('db down'); } },
    });

    assert.equal(result.failed, 1);
    assert.equal(result.paid, 0);
  });
});
