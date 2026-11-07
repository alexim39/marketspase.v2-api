/**
 * Slow-query observability.
 *
 * Mongoose's global plugin marks every query that exceeds
 * `MONGO_SLOW_QUERY_MS` (default 250 ms) and logs one structured
 * `mongo_slow_query` event with collection, operation and duration only —
 * never the filter or any PII. Aggregate stats are exposed through `/health`
 * so an uptime monitor can alert on a spike without needing Mongo access.
 *
 * Process-local by design: restarting the API resets the counters. Long-term
 * trends live in the logs.
 */
import { logger } from './logger.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_COLLECTIONS = 40;

export const slowQueryThresholdMs = () => {
  const raw = Number(process.env.MONGO_SLOW_QUERY_MS || 250);
  return Number.isFinite(raw) && raw > 0 ? Math.max(25, raw) : 250;
};

const state = {
  total: 0,
  maxMs: 0,
  lastAt: null,
  recent: [],
  byCollection: new Map(),
};

const round = (value) => Math.round(value * 10) / 10;
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

const trimRecent = (now) => {
  const cutoff = now - WINDOW_MS;
  while (state.recent.length > 0 && state.recent[0] < cutoff) state.recent.shift();
};

/**
 * Record one slow query. Returns true when the sample crossed the threshold.
 * Safe to call from the Mongoose post hooks; never throws.
 */
export const recordSlowQuery = ({
  collection = 'unknown',
  op = 'query',
  durationMs = 0,
  now = Date.now(),
} = {}) => {
  try {
    const ms = Number(durationMs);
    const threshold = slowQueryThresholdMs();
    if (!Number.isFinite(ms) || ms < threshold) return false;

    state.total += 1;
    state.maxMs = Math.max(state.maxMs, ms);
    state.lastAt = now;
    state.recent.push(now);
    trimRecent(now);

    const name = String(collection || 'unknown').slice(0, 80);
    const key = state.byCollection.has(name) || state.byCollection.size < MAX_COLLECTIONS ? name : 'other';
    const entry = state.byCollection.get(key) ?? { collection: key, count: 0, maxMs: 0, lastAt: null };
    entry.count += 1;
    entry.maxMs = Math.max(entry.maxMs, ms);
    entry.lastAt = now;
    state.byCollection.set(key, entry);

    logger.warn('mongo_slow_query', {
      collection: key,
      op: String(op ?? 'query').slice(0, 40),
      durationMs: round(ms),
      thresholdMs: threshold,
    });
    return true;
  } catch {
    return false;
  }
};

/** Snapshot for `/health` and the ops checker. Contains no query text or PII. */
export const slowQueryStats = (now = Date.now(), { collections = true } = {}) => {
  trimRecent(now);
  const topCollections = collections
    ? [...state.byCollection.values()]
      .sort((a, b) => b.count - a.count || b.maxMs - a.maxMs)
      .slice(0, 5)
      .map((entry) => ({
        collection: entry.collection,
        count: entry.count,
        maxMs: round(entry.maxMs),
        lastAt: iso(entry.lastAt),
      }))
    : [];
  return {
    thresholdMs: slowQueryThresholdMs(),
    windowMinutes: WINDOW_MS / 60000,
    total: state.total,
    recent: state.recent.length,
    maxMs: round(state.maxMs),
    lastAt: iso(state.lastAt),
    topCollections,
  };
};

/** Test helper. */
export const resetSlowQueryStats = () => {
  state.total = 0;
  state.maxMs = 0;
  state.lastAt = null;
  state.recent = [];
  state.byCollection.clear();
};

export default slowQueryStats;
