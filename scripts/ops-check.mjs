#!/usr/bin/env node
/**
 * Operations alert check.
 *
 * Run every 5 minutes from cron, a scheduler or an uptime provider. It probes
 * `/health` and (unless `--api-only`) reads the outbox, job ledger and job
 * lease collections directly. Exit codes: 0 ok, 1 warning, 2 critical.
 *
 * Usage:
 *   npm run ops:check
 *   npm run ops:check -- --json
 *   npm run ops:check -- --api-only --api-url https://api.example.com
 *
 * Optional `OPS_ALERT_WEBHOOK_URL` receives a JSON POST ({text, content,
 * report}) whenever something alerts. The webhook is best-effort and never
 * changes the exit code.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { JobRunModel, jobsHealth } from '../src/jobs/job-health.js';
import { evaluateOpsHealth, opsThresholds } from '../src/jobs/ops-health.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_LOCK_MS = 5 * 60 * 1000;

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const asJson = hasFlag('--json');
const apiOnly = hasFlag('--api-only');
const skipWebhook = hasFlag('--no-webhook');
const apiUrl = String(
  argValue('--api-url') || process.env.OPS_API_URL || `http://127.0.0.1:${process.env.PORT || 8080}`,
).replace(/\/+$/, '');

const mongoUri = process.env.MONGODB_URI
  || (process.env.MONGODB_USERNAME
    ? `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`
    : '');

const round = (value) => Math.round(value * 10) / 10;

const fetchHealth = async () => {
  try {
    const response = await fetch(`${apiUrl}/health`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return { reachable: true, status: 'degraded', error: `HTTP ${response.status} with invalid JSON` };
    }
    return { ...body, reachable: true, httpStatus: response.status };
  } catch (error) {
    return { reachable: false, error: error?.message ?? String(error) };
  }
};

const readOutbox = async (db, now) => {
  const collection = db.collection('outboxjobs');
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const stuckBefore = new Date(now.getTime() - STUCK_LOCK_MS);
  const [groups, oldest, failedRecent, failedTotal, stuckProcessing] = await Promise.all([
    collection.aggregate(
      [{ $group: { _id: '$status', count: { $sum: 1 } } }],
      { maxTimeMS: 5000 },
    ).toArray(),
    collection.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(1).next(),
    collection.countDocuments({ status: 'failed', lastAttemptAt: { $gte: dayAgo } }, { maxTimeMS: 5000 }),
    collection.countDocuments({ status: 'failed' }, { maxTimeMS: 5000 }),
    collection.countDocuments({ status: 'processing', lockedAt: { $lt: stuckBefore } }, { maxTimeMS: 5000 }),
  ]);
  const counts = Object.fromEntries((groups ?? []).map((row) => [row._id, row.count]));
  return {
    pending: counts.pending ?? 0,
    processing: counts.processing ?? 0,
    failedTotal,
    failedRecent,
    stuckProcessing,
    oldestPendingMin: oldest?.createdAt
      ? Math.max(0, round((now.getTime() - new Date(oldest.createdAt).getTime()) / 60000))
      : 0,
  };
};

const readLocks = async (db, now) => {
  const collection = db.collection('joblocks');
  const [expired, oldestExpired, active] = await Promise.all([
    collection.countDocuments({ expiresAt: { $lte: now } }, { maxTimeMS: 5000 }),
    collection.find({ expiresAt: { $lte: now } }).sort({ expiresAt: 1 }).limit(1).next(),
    collection.countDocuments({ expiresAt: { $gt: now } }, { maxTimeMS: 5000 }),
  ]);
  return {
    active,
    expired,
    oldestExpiredMin: oldestExpired?.expiresAt
      ? Math.max(0, round((now.getTime() - new Date(oldestExpired.expiresAt).getTime()) / 60000))
      : 0,
  };
};

const postWebhook = async (report) => {
  if (skipWebhook || report.alerts.length === 0) return;
  const url = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!url) return;
  const text = `[MarketSpase ${report.status.toUpperCase()}] `
    + report.alerts.map((entry) => `${entry.code}: ${entry.message}`).join(' | ');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text, report }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`ops webhook returned HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`ops webhook failed: ${error?.message ?? String(error)}`);
  }
};

const printHuman = (report) => {
  console.log(`MarketSpase ops check: ${report.status.toUpperCase()} at ${report.generatedAt}`);
  if (report.alerts.length === 0) {
    console.log('- no alerts');
  } else {
    for (const entry of report.alerts) {
      console.log(`- [${entry.severity}] ${entry.code} - ${entry.message}`);
    }
  }
  console.log(`Metrics: ${JSON.stringify(report.metrics)}`);
};

const main = async () => {
  const now = new Date();
  const health = await fetchHealth();
  let outbox = {};
  let locks = {};
  let jobs = [];

  if (!apiOnly) {
    if (!mongoUri) {
      throw new Error('MONGODB_URI (or MONGODB_USERNAME) is required unless --api-only is used');
    }
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 3,
      autoIndex: false,
    });
    const db = mongoose.connection.db;
    [outbox, locks, jobs] = await Promise.all([
      readOutbox(db, now),
      readLocks(db, now),
      jobsHealth(JobRunModel, now),
    ]);
  }

  const report = evaluateOpsHealth({
    now,
    thresholds: opsThresholds(),
    outbox,
    locks,
    jobs,
    health,
  });

  if (asJson) {
    console.log(JSON.stringify({ apiUrl, ...report }, null, 2));
  } else {
    printHuman(report);
  }

  await postWebhook(report);
  return report.status === 'critical' ? 2 : report.status === 'warn' ? 1 : 0;
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(async (error) => {
    console.error(`ops check failed: ${error?.message ?? String(error)}`);
    process.exitCode = 2;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => null);
    }
  });
