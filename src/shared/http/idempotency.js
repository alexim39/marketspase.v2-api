import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { clientIp } from './rateLimit.js';
import { logger } from '../observability/logger.js';

const TTL_SECONDS = 24 * 60 * 60;

const idempotencySchema = new mongoose.Schema(
  {
    actorId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: { type: String, enum: ['processing', 'completed'], default: 'processing', index: true },
    responseStatus: { type: Number, default: null },
    responseBody: { type: mongoose.Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
idempotencySchema.index({ actorId: 1, key: 1 }, { unique: true });
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyRecordModel = mongoose.models.IdempotencyRecord
  ?? mongoose.model('IdempotencyRecord', idempotencySchema);

/** Mongo store. A duplicate insert is the claim race — re-read the winner. */
export class MongoIdempotencyStore {
  async claim(input) {
    try {
      const doc = await IdempotencyRecordModel.create(input);
      return { record: doc.toObject(), created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const record = await IdempotencyRecordModel.findOne({
        actorId: input.actorId,
        key: input.key,
      }).lean();
      return { record, created: false };
    }
  }

  async complete(id, responseStatus, responseBody) {
    await IdempotencyRecordModel.updateOne(
      { _id: id, status: 'processing' },
      { $set: { status: 'completed', responseStatus, responseBody } },
    ).catch(() => null);
  }

  async abandon(id) {
    await IdempotencyRecordModel.deleteOne({ _id: id, status: 'processing' }).catch(() => null);
  }
}

const hashRequest = (req) => createHash('sha256')
  .update(JSON.stringify({
    method: req.method,
    path: `${req.baseUrl ?? ''}${req.path ?? ''}`,
    body: req.body ?? null,
  }))
  .digest('hex');

const bodySize = (body) => {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? null), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

/**
 * Generic `Idempotency-Key` support for money-changing POSTs.
 *
 * A successful or deterministic 4xx response is stored for 24h and replayed
 * with `Idempotency-Replayed: true`. A 5xx drops the claim so the client can
 * retry. The same key with a different body returns 409 instead of silently
 * replaying the wrong result.
 */
export const idempotency = ({
  store = new MongoIdempotencyStore(),
  required = false,
  ttlMs = TTL_SECONDS * 1000,
  maxBodyBytes = 64 * 1024,
} = {}) => async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const raw = req.get('Idempotency-Key');
  if (!raw) {
    if (!required) return next();
    return res.status(400).json({
      message: 'This action requires an Idempotency-Key header.',
      success: false,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      fix: 'Send a stable 8–100 character key and retry the same action.',
    });
  }

  const key = String(raw).trim();
  if (key.length < 8 || key.length > 100) {
    return res.status(400).json({
      message: 'Idempotency-Key must be 8–100 characters.',
      success: false,
      code: 'VALIDATION_ERROR',
      fix: 'Use a stable key between 8 and 100 characters.',
    });
  }

  const actorId = req.auth?.partnerId
    ? `user:${String(req.auth.partnerId)}`
    : `ip:${clientIp(req)}`;
  const requestHash = hashRequest(req);

  let claimed;
  try {
    claimed = await store.claim({
      actorId,
      key,
      method: req.method,
      path: `${req.baseUrl ?? ''}${req.path ?? ''}`,
      requestHash,
      status: 'processing',
      expiresAt: new Date(Date.now() + ttlMs),
    });
  } catch (error) {
    logger.error('idempotency_claim_failed', {
      requestId: req.id,
      key,
      error: error?.message ?? String(error),
    });
    return res.status(503).json({
      message: 'We could not secure this action for retry.',
      success: false,
      code: 'IDEMPOTENCY_UNAVAILABLE',
      fix: 'Wait a moment and retry the same action.',
    });
  }

  const record = claimed.record;
  if (!claimed.created && record) {
    if (record.requestHash !== requestHash) {
      return res.status(409).json({
        message: 'This Idempotency-Key was already used for a different request.',
        success: false,
        code: 'IDEMPOTENCY_KEY_REUSED',
        fix: 'Use a new key for a new action, or retry the original request unchanged.',
      });
    }
    if (record.status === 'completed') {
      res.set('Idempotency-Replayed', 'true');
      return res.status(record.responseStatus ?? 200).json(record.responseBody ?? {
        message: 'Request already completed',
        success: true,
        data: null,
      });
    }
    res.set('Retry-After', '1');
    return res.status(409).json({
      message: 'This action is already being processed.',
      success: false,
      code: 'REQUEST_IN_PROGRESS',
      fix: 'Wait a second and retry; the first request will finish first.',
      retry_after: 1,
    });
  }

  req.idempotency = { id: record?._id ?? claimed.record?._id, key, actorId };
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    const id = req.idempotency?.id;
    if (id) {
      if (res.statusCode >= 500 || bodySize(body) > maxBodyBytes) {
        void store.abandon(id);
      } else {
        void store.complete(id, res.statusCode, body);
      }
      req.idempotency = null;
    }
    return sendJson(body);
  };

  return next();
};

export default idempotency;
