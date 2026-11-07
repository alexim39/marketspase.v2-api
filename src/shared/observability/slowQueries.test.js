import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordSlowQuery,
  resetSlowQueryStats,
  slowQueryStats,
  slowQueryThresholdMs,
} from './slowQueries.js';

const withEnv = (patch, fn) => {
  const previous = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
};

test('slow queries below the threshold are ignored', () => {
  resetSlowQueryStats();
  withEnv({ MONGO_SLOW_QUERY_MS: '100' }, () => {
    assert.equal(slowQueryThresholdMs(), 100);
    assert.equal(recordSlowQuery({ collection: 'prospects', op: 'find', durationMs: 99 }), false);
    assert.equal(recordSlowQuery({ collection: 'prospects', op: 'find', durationMs: 100 }), true);
    assert.equal(recordSlowQuery({ collection: 'prospects', op: 'find', durationMs: 350.4 }), true);
    const stats = slowQueryStats();
    assert.equal(stats.total, 2);
    assert.equal(stats.recent, 2);
    assert.equal(stats.maxMs, 350.4);
    assert.equal(stats.topCollections[0].collection, 'prospects');
    assert.equal(stats.topCollections[0].count, 2);
  });
});

test('the public snapshot can hide collection names', () => {
  resetSlowQueryStats();
  withEnv({ MONGO_SLOW_QUERY_MS: '50' }, () => {
    recordSlowQuery({ collection: 'partners', op: 'find', durationMs: 90 });
    const publicStats = slowQueryStats(Date.now(), { collections: false });
    assert.equal(publicStats.total, 1);
    assert.deepEqual(publicStats.topCollections, []);
    assert.equal(slowQueryStats().topCollections[0].collection, 'partners');
  });
});

test('the recent window expires while totals remain', () => {
  resetSlowQueryStats();
  withEnv({ MONGO_SLOW_QUERY_MS: '50' }, () => {
    const at = Date.now();
    recordSlowQuery({ collection: 'partners', op: 'aggregate', durationMs: 90, now: at });
    assert.equal(slowQueryStats(at + 60_000).recent, 1);
    const aged = slowQueryStats(at + 16 * 60_000);
    assert.equal(aged.recent, 0);
    assert.equal(aged.total, 1);
    assert.equal(aged.topCollections[0].collection, 'partners');
  });
});

test('an invalid threshold falls back to the default', () => {
  withEnv({ MONGO_SLOW_QUERY_MS: 'not-a-number' }, () => {
    assert.equal(slowQueryThresholdMs(), 250);
  });
  withEnv({ MONGO_SLOW_QUERY_MS: '1' }, () => {
    assert.equal(slowQueryThresholdMs(), 25);
  });
});

test('reset clears every counter', () => {
  withEnv({ MONGO_SLOW_QUERY_MS: '50' }, () => {
    recordSlowQuery({ collection: 'carts', op: 'find', durationMs: 80 });
    resetSlowQueryStats();
    const stats = slowQueryStats();
    assert.equal(stats.total, 0);
    assert.equal(stats.maxMs, 0);
    assert.deepEqual(stats.topCollections, []);
  });
});
