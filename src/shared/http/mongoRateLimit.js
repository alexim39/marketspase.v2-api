import mongoose from 'mongoose';
import { userKey } from './rateLimit.js';
import { logger } from '../observability/logger.js';

const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
    resetAt: { type: Date, required: true, index: true },
  },
  { timestamps: false },
);
counterSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitCounterModel = mongoose.models.RateLimitCounter
  ?? mongoose.model('RateLimitCounter', counterSchema);

export class MongoRateLimitStore {
  async hit(key, windowMs) {
    if (mongoose.connection?.readyState !== 1) throw new Error('Mongo not connected');
    const now = new Date();
    const resetAt = new Date(now.getTime() + windowMs);
    const active = await RateLimitCounterModel.findOneAndUpdate(
      { key, resetAt: { $gt: now } },
      { $inc: { count: 1 } },
      { new: true },
    ).lean();
    if (active) return active;
    return RateLimitCounterModel.findOneAndUpdate(
      { key },
      { $set: { count: 1, resetAt }, $setOnInsert: { key } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }
}

/**
 * Shared rate-limit counter for multi-replica auth/money actions.
 * The in-memory limiter still provides a cheap burst guard; this layer
 * enforces the hourly account/IP budget across every API instance.
 */
export const mongoRateLimit = ({
  name,
  windowMs = 60_000,
  max = 30,
  key = userKey,
  store = new MongoRateLimitStore(),
} = {}) => async (req, res, next) => {
  try {
    const bucketKey = `${name}:${key(req)}`;
    const entry = await store.hit(bucketKey, windowMs);
    if (Number(entry?.count ?? 0) > max) {
      const retryAfter = Math.max(1, Math.ceil((new Date(entry.resetAt).getTime() - Date.now()) / 1000));
      res.set?.('Retry-After', String(retryAfter));
      return res.status(429).json({
        message: 'Too many requests — please slow down and try again shortly.',
        success: false,
        code: 'RATE_LIMITED',
        fix: `Wait ${retryAfter} second${retryAfter === 1 ? '' : 's'}, then retry once.`,
        retry_after: retryAfter,
      });
    }
    return next();
  } catch (error) {
    logger.warn('mongo_rate_limit_unavailable', {
      name,
      error: error?.message ?? String(error),
      ip: req.ip ?? null,
    });
    // Availability fallback: the route's in-memory limiter still applies.
    return next();
  }
};

export default mongoRateLimit;
