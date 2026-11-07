import express from 'express';
import mongoose from 'mongoose';
import { logger } from '../observability/logger.js';
import { slowQueryStats } from '../observability/slowQueries.js';
import { providerHealth } from '../resilience/CircuitBreaker.js';

const withTimeout = async (promise, ms, code) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(code);
          error.code = code;
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const dbCheck = async () => {
  const startedAt = Date.now();
  const timeoutMs = Math.max(500, Number(process.env.HEALTH_DB_TIMEOUT_MS || 3000));
  if (mongoose.connection?.readyState !== 1 || !mongoose.connection.db) {
    return { status: 'down', latencyMs: null, reason: 'not_connected' };
  }
  try {
    await withTimeout(mongoose.connection.db.admin().ping(), timeoutMs, 'DB_TIMEOUT');
    return { status: 'up', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - startedAt,
      reason: error?.code === 'DB_TIMEOUT' ? 'timeout' : 'ping_failed',
    };
  }
};

const paystackCheck = () => {
  const configured = Boolean(process.env.PAYSTACKTOKEN);
  const breaker = providerHealth().find((entry) => entry.name === 'paystack');
  return {
    status: configured ? 'configured' : 'disabled',
    breaker: breaker?.state ?? 'closed',
    lastSuccessAt: breaker?.lastSuccessAt ?? null,
  };
};

/**
 * Public liveness/readiness endpoints.
 *
 * `/health/live` only says the process is alive. `/health` is readiness:
 * it checks Mongo with a hard 1.5s timeout and reports whether Paystack is
 * configured. It never calls a payment provider on every probe.
 */
export const buildHealthRouter = ({ db = mongoose, paystack = paystackCheck } = {}) => {
  const router = express.Router();
  router.get('/live', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      status: 'ok',
      service: 'marketspase-api',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  router.get('/', async (_req, res) => {
    const startedAt = Date.now();
    const check = db === mongoose ? dbCheck : db;
    const database = await check();
    const payments = paystack();
    const healthy = database.status === 'up';
    const body = {
      status: healthy ? 'ok' : 'degraded',
      service: 'marketspase-api',
      version: process.env.npm_package_version ?? null,
      env: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt,
      checks: {
        database,
        payments,
        providers: providerHealth(),
        slowQueries: slowQueryStats(Date.now(), { collections: false }),
      },
    };
    if (!healthy) {
      logger.warn('health_degraded', { checks: body.checks });
    }
    res.set('Cache-Control', 'no-store');
    res.status(healthy ? 200 : 503).json(body);
  });

  return router;
};

export default buildHealthRouter;
