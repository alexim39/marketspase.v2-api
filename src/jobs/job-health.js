import mongoose from 'mongoose';

/**
 * Automation health — one row per scheduled sweep.
 * schedule.js wraps every sweep in withJobHealth so a stalled or crashing
 * job is visible on the admin Automation desk instead of dying silently
 * in the server logs. Expected cadence per job drives the stale flag.
 */
const jobRunSchema = mongoose.Schema(
  {
    job: { type: String, required: true, unique: true, index: true },
    lastStartedAt: { type: Date, default: null },
    lastFinishedAt: { type: Date, default: null },
    lastOk: { type: Boolean, default: null },
    lastError: { type: String, default: '' },
    lastSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    runs: { type: Number, default: 0 },
    fails: { type: Number, default: 0 },
  },
  { timestamps: false, collection: 'jobruns' },
);

export const JobRunModel =
  mongoose.models.JobRun ?? mongoose.model('JobRun', jobRunSchema);

/** Minutes between expected successful runs, per sweep. */
export const EXPECTED_EVERY_MIN = {
  'campaign-allocation': 60,
  'growth-campaign-allocation': 60,
  'growth-campaign-allocation': 60,
  'campaign-expiry': 26 * 60,
  'leadpool-sweep': 60,
  'mentor-bonus': 90,
  'compensation-reconcile': 90,
  'outbox-delivery': 5,
};

const summarize = (value, max = 2000) => {
  try {
    return JSON.parse(JSON.stringify(value ?? null).slice(0, max));
  } catch {
    return null;
  }
};

export async function recordJobRun(store, job, { ok, error = null, summary = null, startedAt = null, finishedAt = null } = {}) {
  const now = finishedAt ?? new Date();
  await store.updateOne(
    { job },
    {
      $set: {
        lastStartedAt: startedAt,
        lastFinishedAt: now,
        lastOk: !!ok,
        lastError: ok ? '' : String(error?.message ?? error ?? 'unknown error').slice(0, 500),
        lastSummary: summarize(summary),
      },
      $inc: { runs: 1, ...(ok ? {} : { fails: 1 }) },
      $setOnInsert: { job },
    },
    { upsert: true },
  ).catch(() => null);
}

/** Wrap a sweep so every firing (ok or crash) lands in the health ledger. */
export async function withJobHealth(store, job, fn) {
  const startedAt = new Date();
  try {
    const result = await fn();
    await recordJobRun(store, job, { ok: true, summary: result, startedAt });
    return result;
  } catch (error) {
    await recordJobRun(store, job, { ok: false, error, startedAt });
    throw error;
  }
}

/** Health snapshot for the admin desk — stale means no success within cadence. */
export async function jobsHealth(store, now = new Date()) {
  const rows = await store.find({}).lean().catch(() => []);
  const byJob = Object.fromEntries((rows ?? []).map((r) => [String(r.job), r]));
  return Object.entries(EXPECTED_EVERY_MIN).map(([job, everyMin]) => {
    const row = byJob[job] ?? null;
    const lastOkAt = row?.lastFinishedAt && row?.lastOk ? new Date(row.lastFinishedAt) : null;
    const stale = !lastOkAt || Number.isFinite(everyMin) && (now.getTime() - lastOkAt.getTime() > everyMin * 60000);
    return {
      job,
      expectedEveryMin: everyMin,
      lastStartedAt: row?.lastStartedAt ?? null,
      lastFinishedAt: row?.lastFinishedAt ?? null,
      lastOk: row?.lastOk ?? null,
      lastError: row?.lastError ?? '',
      runs: row?.runs ?? 0,
      fails: row?.fails ?? 0,
      lastSummary: row?.lastSummary ?? null,
      stale: !!stale,
      neverRan: !row,
    };
  });
}
