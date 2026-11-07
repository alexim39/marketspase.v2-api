import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOpsHealth, opsThresholds } from './ops-health.js';

const cleanJob = (job) => ({
  job,
  stale: false,
  neverRan: false,
  lastOk: true,
  lastError: '',
});

const codes = (report) => report.alerts.map((entry) => entry.code);

test('a clean snapshot is ok', () => {
  const report = evaluateOpsHealth({
    jobs: [cleanJob('outbox-delivery')],
    health: {
      reachable: true,
      status: 'ok',
      checks: {
        database: { status: 'up' },
        providers: [{ name: 'paystack', state: 'closed' }],
        slowQueries: { recent: 0, windowMinutes: 15 },
      },
    },
  });
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.alerts, []);
});

test('an outbox backlog escalates from warn to critical', () => {
  const warn = evaluateOpsHealth({ outbox: { pending: 100 } });
  assert.equal(warn.status, 'warn');
  assert.ok(codes(warn).includes('OUTBOX_BACKLOG'));

  const critical = evaluateOpsHealth({ outbox: { pending: 500 } });
  assert.equal(critical.status, 'critical');
  assert.equal(critical.alerts[0].code, 'OUTBOX_BACKLOG');
  assert.equal(critical.alerts[0].severity, 'critical');
});

test('oldest pending age only matters while rows are pending', () => {
  const idle = evaluateOpsHealth({ outbox: { pending: 0, oldestPendingMin: 500 } });
  assert.equal(idle.status, 'ok');

  const stuck = evaluateOpsHealth({ outbox: { pending: 1, oldestPendingMin: 61 } });
  assert.ok(codes(stuck).includes('OUTBOX_OLDEST'));
  assert.equal(stuck.alerts.find((a) => a.code === 'OUTBOX_OLDEST').severity, 'critical');
});

test('failed and stuck outbox rows raise alerts', () => {
  const report = evaluateOpsHealth({
    outbox: { pending: 1, failedRecent: 2, stuckProcessing: 1 },
  });
  assert.ok(codes(report).includes('OUTBOX_FAILED'));
  assert.ok(codes(report).includes('OUTBOX_STUCK'));
  assert.equal(report.metrics.outbox.failedRecent, 2);
});

test('never-ran jobs warn but do not count as stale', () => {
  const report = evaluateOpsHealth({
    jobs: [
      { job: 'store-order-expiry', stale: true, neverRan: true, lastOk: null },
      { job: 'outbox-delivery', stale: true, neverRan: false, lastOk: true },
    ],
  });
  assert.ok(codes(report).includes('JOBS_NEVER_RAN'));
  assert.ok(codes(report).includes('JOBS_STALE'));
  assert.deepEqual(report.metrics.jobs.stale, ['outbox-delivery']);
  assert.deepEqual(report.metrics.jobs.neverRan, ['store-order-expiry']);
  assert.equal(report.status, 'warn');
});

test('several stale or failing jobs become critical', () => {
  const report = evaluateOpsHealth({
    jobs: [
      { job: 'a', stale: true, neverRan: false, lastOk: false },
      { job: 'b', stale: true, neverRan: false, lastOk: false },
      { job: 'c', stale: true, neverRan: false, lastOk: false },
    ],
  });
  assert.equal(report.status, 'critical');
  assert.ok(codes(report).includes('JOBS_STALE'));
  assert.ok(codes(report).includes('JOBS_FAILING'));
  assert.deepEqual(report.metrics.jobs.failing, ['a', 'b', 'c']);
});

test('an expired lease becomes critical once it is old', () => {
  const young = evaluateOpsHealth({ locks: { expired: 1, oldestExpiredMin: 5 } });
  assert.deepEqual(codes(young), ['JOB_LOCK_EXPIRED']);
  assert.equal(young.status, 'warn');

  const old = evaluateOpsHealth({ locks: { expired: 1, oldestExpiredMin: 31 } });
  assert.ok(codes(old).includes('JOB_LOCK_STUCK'));
  assert.equal(old.status, 'critical');
});

test('an unreachable health endpoint is critical', () => {
  const report = evaluateOpsHealth({ health: { reachable: false, error: 'ECONNREFUSED' } });
  assert.equal(report.status, 'critical');
  assert.ok(codes(report).includes('HEALTH_UNREACHABLE'));
});

test('a degraded health response names the database when it is down', () => {
  const report = evaluateOpsHealth({
    health: {
      reachable: true,
      status: 'degraded',
      checks: { database: { status: 'down', reason: 'timeout' }, providers: [] },
    },
  });
  assert.ok(codes(report).includes('DB_DOWN'));
  assert.ok(!codes(report).includes('HEALTH_DEGRADED'));
});

test('an open paystack breaker is critical, other providers warn', () => {
  const report = evaluateOpsHealth({
    health: {
      reachable: true,
      status: 'ok',
      checks: {
        database: { status: 'up' },
        providers: [
          { name: 'paystack', state: 'open', retryAfter: 42 },
          { name: 'deepseek', state: 'open', retryAfter: 10 },
        ],
      },
    },
  });
  assert.equal(report.status, 'critical');
  assert.ok(codes(report).includes('PAYSTACK_BREAKER_OPEN'));
  assert.ok(codes(report).includes('PROVIDER_BREAKER_OPEN'));
});

test('slow query spikes alert at the configured threshold', () => {
  const warn = evaluateOpsHealth({
    health: { reachable: true, status: 'ok', checks: { slowQueries: { recent: 5, windowMinutes: 15 } } },
  });
  assert.ok(codes(warn).includes('SLOW_QUERIES'));
  assert.equal(warn.status, 'warn');

  const critical = evaluateOpsHealth({
    health: { reachable: true, status: 'ok', checks: { slowQueries: { recent: 25, windowMinutes: 15 } } },
  });
  assert.equal(critical.status, 'critical');
});

test('thresholds can be tuned through env names', () => {
  const thresholds = opsThresholds({
    OPS_OUTBOX_PENDING_WARN: '10',
    OPS_OUTBOX_PENDING_CRIT: '20',
    OPS_SLOW_QUERY_RECENT_WARN: 'oops',
  });
  assert.equal(thresholds.outboxPendingWarn, 10);
  assert.equal(thresholds.outboxPendingCrit, 20);
  assert.equal(thresholds.slowQueryRecentWarn, 5);
});
