import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jobsHealth, recordJobRun, withJobHealth } from './job-health.js';

const fakeStore = (rows = []) => {
  const byJob = new Map(rows.map((r) => [r.job, { ...r }]));
  return {
    rows: byJob,
    async updateOne(filter, update) {
      const row = byJob.get(filter.job) ?? { job: filter.job, runs: 0, fails: 0 };
      Object.assign(row, update.$set ?? {});
      for (const [k, v] of Object.entries(update.$inc ?? {})) row[k] = (row[k] ?? 0) + v;
      byJob.set(filter.job, row);
    },
    find() {
      return { lean: async () => [...byJob.values()] };
    },
  };
};

describe('job health ledger', () => {
  it('records ok and failed runs', async () => {
    const store = fakeStore();
    await recordJobRun(store, 'campaign-allocation', { ok: true, summary: { delivered: 2 } });
    await recordJobRun(store, 'campaign-allocation', { ok: false, error: new Error('boom') });
    const row = store.rows.get('campaign-allocation');
    assert.equal(row.runs, 2);
    assert.equal(row.fails, 1);
    assert.equal(row.lastOk, false);
    assert.equal(row.lastError, 'boom');
  });

  it('withJobHealth returns the result and records it', async () => {
    const store = fakeStore();
    const out = await withJobHealth(store, 'leadpool-sweep', async () => ({ warned: 1 }));
    assert.deepEqual(out, { warned: 1 });
    assert.equal(store.rows.get('leadpool-sweep').runs, 1);
    await assert.rejects(withJobHealth(store, 'leadpool-sweep', async () => { throw new Error('down'); }), /down/);
    assert.equal(store.rows.get('leadpool-sweep').fails, 1);
  });

  it('flags sweeps with no recent success as stale', async () => {
    const now = new Date('2026-03-01T12:00:00Z');
    const store = fakeStore([
      { job: 'campaign-allocation', lastFinishedAt: new Date('2026-03-01T11:50:00Z'), lastOk: true, runs: 10, fails: 0 },
      { job: 'campaign-expiry', lastFinishedAt: new Date('2026-02-27T01:30:00Z'), lastOk: true, runs: 4, fails: 0 },
      { job: 'leadpool-sweep', lastFinishedAt: new Date('2026-03-01T11:50:00Z'), lastOk: false, runs: 10, fails: 1 },
    ]);
    const health = await jobsHealth(store, now);
    const byJob = Object.fromEntries(health.map((h) => [h.job, h]));
    assert.equal(byJob['campaign-allocation'].stale, false);
    assert.equal(byJob['campaign-expiry'].stale, true);
    assert.equal(byJob['leadpool-sweep'].stale, true);
  });

  it('marks never-ran jobs stale', async () => {
    const store = fakeStore([]);
    const health = await jobsHealth(store, new Date());
    assert.ok(health.every((h) => h.stale && h.neverRan));
  });
});
