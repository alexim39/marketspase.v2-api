import { ProlificWomanLeadMongooseModel } from './Lead.schema.js';
import { ProlificWomanLeadMapper } from './Lead.mapper.js';

/** Status facet for the admin desk: new = never accepted, accepted = in a pipeline. */
const statusFilter = (status) => {
  if (status === 'new') return { acceptedAt: null };
  if (status === 'accepted') return { acceptedAt: { $ne: null } };
  return {};
};

export class MongoProlificWomanLeadRepository {
  async save(entity) {
    const created = await ProlificWomanLeadMongooseModel.create(
      ProlificWomanLeadMapper.toPersistence(entity),
    );
    return ProlificWomanLeadMapper.toDomain(created);
  }

  async findById(id) {
    const doc = await ProlificWomanLeadMongooseModel.findById(id).lean().catch(() => null);
    return doc ? ProlificWomanLeadMapper.toDomain(doc) : null;
  }

  async list({ q = '', limit = 25, skip = 0, status = 'all' } = {}) {
    return this.listWhere(statusFilter(status), { q, limit, skip });
  }

  async listPending({ q = '', limit = 500, skip = 0 } = {}) {
    return this.listWhere({ acceptedAt: null }, { q, limit, skip });
  }

  async listWhere(baseFilter, { q = '', limit = 25, skip = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 500);
    const sk = Math.max(Number(skip) || 0, 0);
    const query = String(q ?? '').trim();
    const filter = { ...baseFilter };

    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [{ name: rx }, { phone: rx }, { location: rx }];
    }

    const [docs, total] = await Promise.all([
      ProlificWomanLeadMongooseModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(sk)
        .limit(lim)
        .lean(),
      ProlificWomanLeadMongooseModel.countDocuments(filter),
    ]);

    return {
      items: docs.map(ProlificWomanLeadMapper.toDomain),
      total,
      limit: lim,
      skip: sk,
    };
  }

  async claimForAccept({ id, partnerId, now = new Date() }) {
    const doc = await ProlificWomanLeadMongooseModel.findOneAndUpdate(
      { _id: id, acceptedAt: null },
      {
        $set: {
          status: 'accepted',
          acceptedAt: now,
          acceptedByPartnerId: partnerId,
        },
      },
      { new: true },
    ).lean();
    return doc ? ProlificWomanLeadMapper.toDomain(doc) : null;
  }

  async setProspectId(id, prospectId) {
    await ProlificWomanLeadMongooseModel.updateOne(
      { _id: id },
      { $set: { prospectId } },
    );
  }

  async releaseClaim(id) {
    await ProlificWomanLeadMongooseModel.updateOne(
      { _id: id, prospectId: null },
      {
        $set: { status: 'new', acceptedAt: null },
        $unset: { acceptedByPartnerId: 1 },
      },
    );
  }

  /**
   * Hard delete — only unaccepted rows. Accepted rows already live on as
   * pipeline prospects, so removing them here would orphan the trail.
   * Returns the deleted domain row, or null when missing/already accepted.
   */
  async removeById(id) {
    const doc = await ProlificWomanLeadMongooseModel.findOneAndDelete({
      _id: id,
      acceptedAt: null,
    }).lean().catch(() => null);
    return doc ? ProlificWomanLeadMapper.toDomain(doc) : null;
  }
}
