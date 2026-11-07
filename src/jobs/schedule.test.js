import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledRun } from './schedule.js';

const passThroughLock = async (_name, fn) => fn();

test('scheduledRun returns the job result on success', async () => {
  const result = await scheduledRun('ok-job', async () => ({ done: 3 }), 1000, {
    lock: passThroughLock,
  })();

  assert.deepEqual(result, { done: 3 });
});

test('scheduledRun logs and swallows job failures', async () => {
  const result = await scheduledRun('broken-job', async () => {
    throw new Error('boom');
  }, 1000, { lock: passThroughLock })();

  assert.deepEqual(result, { failed: true, job: 'broken-job' });
});
