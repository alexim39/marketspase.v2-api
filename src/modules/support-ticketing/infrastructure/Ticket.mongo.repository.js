import { TicketMongooseModel } from './Ticket.schema.js';
import { TicketMapper } from './Ticket.mapper.js';

/**
 * Infrastructure: Mongo implementation of `TicketRepository`.
 * Uses `.lean()` on reads; writes go through the mapper so
 * callers never see Mongoose internals.
 */
export class MongoTicketRepository {
  /** @param {any} entity domain entity @returns {Promise<any>} domain object */
  async save(entity) {
    const created = await TicketMongooseModel.create(TicketMapper.toPersistence(entity));
    return TicketMapper.toDomain(created);
  }

  async findById(id) {
    const doc = await TicketMongooseModel.findById(id).lean().catch(() => null);
    return doc ? TicketMapper.toDomain(doc) : null;
  }

  /** Admin inbox listing — newest first, optional status filter + text search. */
  async list({ status = null, q = '', limit = 25, skip = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const and = [];
    // Legacy rows predate `status` — they count as open everywhere.
    if (status) {
      and.push(status === 'open'
        ? { $or: [{ status: 'open' }, { status: { $exists: false } }] }
        : { status: String(status) });
    }
    const query = String(q ?? '').trim();
    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      and.push({ $or: [{ subject: re }, { description: re }, { category: re }] });
    }
    const filter = and.length > 0 ? { $and: and } : {};
    const [docs, total] = await Promise.all([
      TicketMongooseModel.find(filter).sort({ createdAt: -1 }).skip(sk).limit(lim).lean(),
      TicketMongooseModel.countDocuments(filter),
    ]);
    return { items: docs.map(TicketMapper.toDomain), total, limit: lim, skip: sk };
  }

  async updateDecision(id, patch) {
    const doc = await TicketMongooseModel.findByIdAndUpdate(
      id,
      { $set: patch },
      { new: true },
    ).lean();
    return doc ? TicketMapper.toDomain(doc) : null;
  }

  /** GDPR erasure helper — count of owned tickets removed. */
  async deleteByPartner(partnerId) {
    const res = await TicketMongooseModel.deleteMany({ partnerId });
    return res.deletedCount ?? 0;
  }
}
