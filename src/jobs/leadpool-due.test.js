import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadPoolDueJob, runLeadPoolDueJob } from './leadpool-due.js';

test('job builds with production defaults (no crash on boot)', () => {
  const job = buildLeadPoolDueJob();
  assert.ok(job);
});

test('runner with empty fakes reports zero, never crashes', async () => {
  const emptyClaims = {
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
  };
  const res = await runLeadPoolDueJob({
    claims: emptyClaims,
    release: { execute: async () => ({ released: true }) },
    notify: async () => {},
  });
  assert.deepEqual(
    { checked: res.checked, warned: res.warned, expired: res.expired, failed: res.failed },
    { checked: 0, warned: 0, expired: 0, failed: [] },
  );
});
