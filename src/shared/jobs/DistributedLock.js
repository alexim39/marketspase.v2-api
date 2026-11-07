import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { logger } from '../observability/logger.js';

const lockSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: false },
);

export const JobLockModel = mongoose.models.JobLock
  ?? mongoose.model('JobLock', lockSchema);

export class MongoJobLockStore {
  async acquire(name, owner, ttlMs) {
    if (mongoose.connection?.readyState !== 1) return true; // single-process fallback
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    try {
      const doc = await JobLockModel.findOneAndUpdate(
        {
          name,
          $or: [{ expiresAt: { $lte: now } }, { expiresAt: null }],
        },
        { $set: { owner, expiresAt } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();
      return doc?.owner === owner;
    } catch (error) {
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  async release(name, owner) {
    if (mongoose.connection?.readyState !== 1) return;
    await JobLockModel.deleteOne({ name, owner }).catch(() => null);
  }
}

/**
 * One-run-per-cluster lease for cron sweeps. A crashed worker's lease expires
 * after `ttlMs`, so the next tick can recover. Outbox rows are independently
 * claimed, so this only prevents duplicate cron fan-out.
 */
export const withDistributedLock = async (
  name,
  fn,
  { ttlMs = 10 * 60 * 1000, store = new MongoJobLockStore() } = {},
) => {
  const owner = crypto.randomUUID();
  let acquired = true;
  try {
    acquired = await store.acquire(name, owner, ttlMs);
  } catch (error) {
    logger.warn('job_lock_unavailable', { name, error: error?.message ?? String(error) });
  }
  if (!acquired) {
    logger.debug('job_lock_skipped', { name });
    return { skipped: true, name };
  }
  try {
    return await fn();
  } finally {
    await store.release(name, owner);
  }
};

export default withDistributedLock;
