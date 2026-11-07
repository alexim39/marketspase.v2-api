import test from 'node:test';
import assert from 'node:assert/strict';
import { withDistributedLock } from './DistributedLock.js';

test('runs once and releases the lease', async () => {
  let held = false;
  const store = {
    acquire: async () => {
      if (held) return false;
      held = true;
      return true;
    },
    release: async () => { held = false; },
  };
  const first = await withDistributedLock('job', async () => 'ran', { store });
  const second = await withDistributedLock('job', async () => 'ran', { store });
  assert.equal(first, 'ran');
  assert.equal(second, 'ran'); // released after first
});

test('skips when another worker holds the lease', async () => {
  const store = { acquire: async () => false, release: async () => {} };
  const out = await withDistributedLock('job', async () => 'ran', { store });
  assert.equal(out.skipped, true);
});
