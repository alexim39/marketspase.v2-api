import { AuditLogModel } from './Audit.mongo.model.js';
import { createAuditEntry } from '../domain/AuditLog.js';

const shaped = (d) => ({
  id: String(d._id),
  actorId: d.actorId,
  actorLabel: d.actorLabel ?? null,
  action: d.action,
  targetType: d.targetType ?? null,
  targetId: d.targetId ?? null,
  detail: d.detail ?? null,
  createdAt: d.createdAt ?? null,
});

/** Mongo implementation. Reads use `.lean()`. */
export class MongoAuditStore {
  /**
   * Best-effort append — resolves null (never rejects) so a logging
   * failure can never fail the admin action it records.
   */
  async record(input) {
    try {
      const doc = await AuditLogModel.create(createAuditEntry(input));
      return shaped(doc.toObject());
    } catch (error) {
      console.warn('[audit] record skipped:', error?.message ?? error);
      return null;
    }
  }

  async list({ actorId = null, action = null, from = null, to = null, limit = 50, skip = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const filter = {};
    if (actorId) filter.actorId = String(actorId);
    if (action) filter.action = String(action);
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }
    const [docs, total] = await Promise.all([
      AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(sk).limit(lim).lean(),
      AuditLogModel.countDocuments(filter),
    ]);
    return { items: docs.map(shaped), total, limit: lim, skip: sk };
  }
}
