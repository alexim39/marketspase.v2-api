import mongoose from 'mongoose';

/**
 * Durable side-effect outbox.
 *
 * Domain events write here instead of sending mail/SMS/push inside the
 * request. A worker claims rows atomically (safe across replicas), retries
 * with exponential backoff, and leaves failures in `failed` for inspection.
 */
const outboxSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['email', 'sms', 'push'], required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending', index: true },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lockedAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    completedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
  },
  { timestamps: false },
);
outboxSchema.index({ status: 1, nextAttemptAt: 1 });
outboxSchema.index({ status: 1, lockedAt: 1 });

export const OutboxJobModel = mongoose.models.OutboxJob
  ?? mongoose.model('OutboxJob', outboxSchema);

export class MongoOutbox {
  async enqueue({ channel, payload }) {
    const doc = await OutboxJobModel.create({ channel, payload });
    return { id: String(doc._id) };
  }

  async claimDue({ limit = 20, now = new Date(), lockMs = 60_000 } = {}) {
    // Requeue work orphaned by a crashed worker before claiming new rows.
    await OutboxJobModel.updateMany(
      { status: 'processing', lockedAt: { $lt: new Date(now.getTime() - lockMs) } },
      { $set: { status: 'pending', lockedAt: null, nextAttemptAt: now } },
    ).catch(() => null);

    const claimed = [];
    for (let i = 0; i < limit; i += 1) {
      const doc = await OutboxJobModel.findOneAndUpdate(
        {
          status: 'pending',
          nextAttemptAt: { $lte: now },
        },
        {
          $set: { status: 'processing', lockedAt: now, lastAttemptAt: now },
          $inc: { attempts: 1 },
        },
        { new: true, sort: { createdAt: 1 } },
      ).lean();
      if (!doc) break;
      claimed.push(doc);
    }
    return claimed;
  }

  async complete(id) {
    await OutboxJobModel.updateOne(
      { _id: id },
      { $set: { status: 'completed', completedAt: new Date(), lockedAt: null, lastError: null } },
    ).catch(() => null);
  }

  async retry(id, error, now = new Date()) {
    const doc = await OutboxJobModel.findById(id).select('attempts').lean();
    const attempts = Number(doc?.attempts ?? 1);
    const failed = attempts >= 5;
    const delay = Math.min(15 * 60 * 1000, 2 ** attempts * 1000);
    await OutboxJobModel.updateOne(
      { _id: id },
      {
        $set: {
          status: failed ? 'failed' : 'pending',
          lastError: String(error?.message ?? error ?? 'Unknown error').slice(0, 500),
          lockedAt: null,
          nextAttemptAt: new Date(now.getTime() + delay),
        },
      },
    ).catch(() => null);
    return { failed, attempts };
  }
}

export default MongoOutbox;
