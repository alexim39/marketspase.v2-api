/**
 * Pure evaluation for the operations alert check.
 *
 * `scripts/ops-check.mjs` gathers a snapshot (health endpoint, outbox rows,
 * job ledger, leases) and this module decides whether a human should be
 * paged. Keeping the rules pure makes every threshold testable without a
 * database or a live API.
 */

const DEFAULTS = Object.freeze({
  outboxPendingWarn: 100,
  outboxPendingCrit: 500,
  outboxOldestMinWarn: 15,
  outboxOldestMinCrit: 60,
  outboxFailedWarn: 1,
  outboxFailedCrit: 10,
  outboxStuckWarn: 1,
  outboxStuckCrit: 10,
  jobStaleWarn: 1,
  jobStaleCrit: 3,
  jobFailingWarn: 1,
  jobFailingCrit: 3,
  lockExpiredWarn: 1,
  lockExpiredCrit: 10,
  lockStuckMin: 30,
  slowQueryRecentWarn: 5,
  slowQueryRecentCrit: 25,
});

const int = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/** Thresholds are environment-tunable; invalid values fall back quietly. */
export const opsThresholds = (env = process.env) => ({
  outboxPendingWarn: int(env.OPS_OUTBOX_PENDING_WARN, DEFAULTS.outboxPendingWarn),
  outboxPendingCrit: int(env.OPS_OUTBOX_PENDING_CRIT, DEFAULTS.outboxPendingCrit),
  outboxOldestMinWarn: int(env.OPS_OUTBOX_OLDEST_MIN_WARN, DEFAULTS.outboxOldestMinWarn),
  outboxOldestMinCrit: int(env.OPS_OUTBOX_OLDEST_MIN_CRIT, DEFAULTS.outboxOldestMinCrit),
  outboxFailedWarn: int(env.OPS_OUTBOX_FAILED_WARN, DEFAULTS.outboxFailedWarn),
  outboxFailedCrit: int(env.OPS_OUTBOX_FAILED_CRIT, DEFAULTS.outboxFailedCrit),
  outboxStuckWarn: int(env.OPS_OUTBOX_STUCK_WARN, DEFAULTS.outboxStuckWarn),
  outboxStuckCrit: int(env.OPS_OUTBOX_STUCK_CRIT, DEFAULTS.outboxStuckCrit),
  jobStaleWarn: int(env.OPS_JOB_STALE_WARN, DEFAULTS.jobStaleWarn),
  jobStaleCrit: int(env.OPS_JOB_STALE_CRIT, DEFAULTS.jobStaleCrit),
  jobFailingWarn: int(env.OPS_JOB_FAILING_WARN, DEFAULTS.jobFailingWarn),
  jobFailingCrit: int(env.OPS_JOB_FAILING_CRIT, DEFAULTS.jobFailingCrit),
  lockExpiredWarn: int(env.OPS_LOCK_EXPIRED_WARN, DEFAULTS.lockExpiredWarn),
  lockExpiredCrit: int(env.OPS_LOCK_EXPIRED_CRIT, DEFAULTS.lockExpiredCrit),
  lockStuckMin: int(env.OPS_LOCK_STUCK_MIN, DEFAULTS.lockStuckMin),
  slowQueryRecentWarn: int(env.OPS_SLOW_QUERY_RECENT_WARN, DEFAULTS.slowQueryRecentWarn),
  slowQueryRecentCrit: int(env.OPS_SLOW_QUERY_RECENT_CRIT, DEFAULTS.slowQueryRecentCrit),
});

const severityRank = { warn: 1, critical: 2 };

const alert = (severity, code, message, value, threshold) => ({
  severity,
  code,
  message,
  value,
  threshold,
});

const thresholdAlert = ({ value, warn, crit, code, label, unit = '' }) => {
  if (value >= crit) {
    return alert('critical', code, `${label}: ${value}${unit} (critical at ${crit}${unit})`, value, crit);
  }
  if (value >= warn) {
    return alert('warn', code, `${label}: ${value}${unit} (warn at ${warn}${unit})`, value, warn);
  }
  return null;
};

/**
 * @param {{
 *   now?: Date,
 *   thresholds?: object,
 *   outbox?: object,
 *   jobs?: Array<object>,
 *   locks?: object,
 *   health?: object,
 * }} input
 */
export const evaluateOpsHealth = ({
  now = new Date(),
  thresholds = opsThresholds(),
  outbox = {},
  jobs = [],
  locks = {},
  health = {},
} = {}) => {
  const alerts = [];
  const add = (entry) => { if (entry) alerts.push(entry); };

  const outboxPending = int(outbox.pending, 0);
  const outboxOldest = int(outbox.oldestPendingMin, 0);
  const outboxFailed = int(outbox.failedRecent, 0);
  const outboxStuck = int(outbox.stuckProcessing, 0);

  add(thresholdAlert({
    value: outboxPending,
    warn: thresholds.outboxPendingWarn,
    crit: thresholds.outboxPendingCrit,
    code: 'OUTBOX_BACKLOG',
    label: 'Outbox pending rows',
  }));
  if (outboxPending > 0) {
    add(thresholdAlert({
      value: outboxOldest,
      warn: thresholds.outboxOldestMinWarn,
      crit: thresholds.outboxOldestMinCrit,
      code: 'OUTBOX_OLDEST',
      label: 'Oldest pending outbox row',
      unit: ' min',
    }));
  }
  add(thresholdAlert({
    value: outboxFailed,
    warn: thresholds.outboxFailedWarn,
    crit: thresholds.outboxFailedCrit,
    code: 'OUTBOX_FAILED',
    label: 'Outbox rows failed in the last 24h',
  }));
  add(thresholdAlert({
    value: outboxStuck,
    warn: thresholds.outboxStuckWarn,
    crit: thresholds.outboxStuckCrit,
    code: 'OUTBOX_STUCK',
    label: 'Outbox rows stuck in processing',
  }));

  const staleJobs = jobs.filter((job) => job.stale && !job.neverRan);
  const neverRan = jobs.filter((job) => job.neverRan);
  const failingJobs = jobs.filter((job) => job.lastOk === false && !job.neverRan);

  add(thresholdAlert({
    value: staleJobs.length,
    warn: thresholds.jobStaleWarn,
    crit: thresholds.jobStaleCrit,
    code: 'JOBS_STALE',
    label: 'Scheduled jobs without a recent success',
  }));
  add(thresholdAlert({
    value: failingJobs.length,
    warn: thresholds.jobFailingWarn,
    crit: thresholds.jobFailingCrit,
    code: 'JOBS_FAILING',
    label: 'Scheduled jobs whose last run failed',
  }));
  if (neverRan.length > 0) {
    alerts.push(alert(
      'warn',
      'JOBS_NEVER_RAN',
      `${neverRan.length} job(s) have no run record yet: ${neverRan.slice(0, 5).map((j) => j.job).join(', ')}`,
      neverRan.length,
      1,
    ));
  }

  const expiredLocks = int(locks.expired, 0);
  const oldestExpiredMin = int(locks.oldestExpiredMin, 0);
  add(thresholdAlert({
    value: expiredLocks,
    warn: thresholds.lockExpiredWarn,
    crit: thresholds.lockExpiredCrit,
    code: 'JOB_LOCK_EXPIRED',
    label: 'Expired job leases waiting for cleanup',
  }));
  if (expiredLocks > 0 && oldestExpiredMin >= thresholds.lockStuckMin) {
    alerts.push(alert(
      'critical',
      'JOB_LOCK_STUCK',
      `The oldest expired lease is ${oldestExpiredMin} min past expiry; scheduled work may be stalled`,
      oldestExpiredMin,
      thresholds.lockStuckMin,
    ));
  }

  const providers = Array.isArray(health?.checks?.providers) ? health.checks.providers : [];
  for (const provider of providers) {
    if (provider?.state !== 'open') continue;
    const money = String(provider.name ?? '') === 'paystack';
    alerts.push(alert(
      money ? 'critical' : 'warn',
      money ? 'PAYSTACK_BREAKER_OPEN' : 'PROVIDER_BREAKER_OPEN',
      `${provider.name ?? 'provider'} circuit is open (retry in ${provider.retryAfter ?? '?'}s)`,
      provider.retryAfter ?? null,
      null,
    ));
  }

  if (health?.reachable === false) {
    alerts.push(alert(
      'critical',
      'HEALTH_UNREACHABLE',
      `Health endpoint unreachable: ${health.error ?? 'unknown error'}`,
      null,
      null,
    ));
  } else if (health?.status && health.status !== 'ok') {
    const dbDown = health?.checks?.database?.status === 'down';
    alerts.push(alert(
      'critical',
      dbDown ? 'DB_DOWN' : 'HEALTH_DEGRADED',
      dbDown
        ? `Database check is down${health?.checks?.database?.reason ? ` (${health.checks.database.reason})` : ''}`
        : `Health status is ${health.status}`,
      health.status,
      'ok',
    ));
  }

  const slowQueries = health?.checks?.slowQueries ?? null;
  if (slowQueries) {
    add(thresholdAlert({
      value: int(slowQueries.recent, 0),
      warn: thresholds.slowQueryRecentWarn,
      crit: thresholds.slowQueryRecentCrit,
      code: 'SLOW_QUERIES',
      label: `Slow queries in the last ${slowQueries.windowMinutes ?? 15} min`,
    }));
  }

  alerts.sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0));
  const status = alerts.some((entry) => entry.severity === 'critical')
    ? 'critical'
    : alerts.length > 0 ? 'warn' : 'ok';

  return {
    status,
    generatedAt: new Date(now).toISOString(),
    alerts,
    metrics: {
      outbox: {
        pending: outboxPending,
        oldestPendingMin: outboxOldest,
        failedRecent: outboxFailed,
        failedTotal: int(outbox.failedTotal, 0),
        stuckProcessing: outboxStuck,
        processing: int(outbox.processing, 0),
      },
      jobs: {
        total: jobs.length,
        stale: staleJobs.map((job) => job.job),
        failing: failingJobs.map((job) => job.job),
        neverRan: neverRan.map((job) => job.job),
      },
      locks: {
        active: int(locks.active, 0),
        expired: expiredLocks,
        oldestExpiredMin,
      },
      health: {
        reachable: health?.reachable !== false,
        status: health?.status ?? 'unknown',
        database: health?.checks?.database?.status ?? 'unknown',
        openProviders: providers.filter((p) => p?.state === 'open').map((p) => p.name),
      },
      slowQueries,
    },
  };
};

export default evaluateOpsHealth;
