import { ConflictException } from '../../../shared/domain/AppError.js';
import { ReservationCodeModel } from '../../../apps/reservation-code/models/reservation-code.model.js';

const oid = (v) => String(v);
// Never emit the literal strings 'undefined'/'null' for missing refs —
// they poison every downstream $in cast. Missing stays null.
const oidOrNull = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const shaped = (o) => (o ? { ...o, id: oid(o._id), partnerId: oidOrNull(o.partnerId) } : null);

/** Mongo implementation on the shared `reservation-codes` collection. Reads use `.lean()`. */
export class MongoReservationStore {
  async findByCode(code) {
    const doc = await ReservationCodeModel.findOne({ code: String(code).trim() })
      .collation({ locale: 'en', strength: 2 })
      .lean();
    if (!doc) return null;
    return {
      ...shaped(doc),
      status: doc.status,
      prospectId: doc.prospectId ? oid(doc.prospectId) : null,
      recordedBy: oidOrNull(doc.recordedBy),
    };
  }

  /**
   * Record a code: new codes land Approved (ready to use).
   * partnerId is the CREDIT HOLDER (beneficiary); recordedBy carries the
   * submitting actor for on-behalf records (null = self-recorded).
   * Re-recording your own code attaches/updates the prospect link.
   * Another holder's code → 409 (compared on beneficiary, never actor).
   */
  async record({ code, partnerId, prospectId = null, recordedBy = null }) {
    const existing = await this.findByCode(code);
    if (existing) {
      if (String(existing.partnerId) !== String(partnerId)) {
        throw new ConflictException('This reservation code is already recorded by another partner');
      }
      const doc = await ReservationCodeModel.findOneAndUpdate(
        { code: String(code).trim() },
        { $set: { status: 'Approved', ...(prospectId ? { prospectId } : {}), ...(recordedBy ? { recordedBy } : {}) } },
        { new: true },
      ).lean();
      return { ...shaped(doc), status: doc.status, prospectId: doc.prospectId ? oid(doc.prospectId) : null, recordedBy: oidOrNull(doc.recordedBy) };
    }
    const doc = await ReservationCodeModel.create({
      code: String(code).trim(),
      partnerId,
      ...(prospectId ? { prospectId } : {}),
      ...(recordedBy ? { recordedBy } : {}),
      status: 'Approved',
    });
    const o = doc.toObject();
    return { ...shaped(o), status: o.status, prospectId: o.prospectId ? oid(o.prospectId) : null, recordedBy: oidOrNull(o.recordedBy) };
  }

  async markUsed(code, { session } = {}) {
    const res = await ReservationCodeModel.updateOne(
      { code: String(code).trim() },
      { $set: { status: 'Used' } },
      session ? { session } : {},
    );
    return { used: (res.modifiedCount ?? 0) > 0 };
  }

  async findById(id) {
    const doc = await ReservationCodeModel.findById(id).lean().catch(() => null);
    if (!doc) return null;
    return { ...shaped(doc), status: doc.status, prospectId: doc.prospectId ? oid(doc.prospectId) : null, recordedBy: oidOrNull(doc.recordedBy) };
  }

  async listByPartner(partnerId, limit = 50, status = null) {    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const filter = { partnerId };
    if (status && status !== 'All') filter.status = String(status);
    const docs = await ReservationCodeModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(lim)
      .lean();
    return docs.map((d) => ({
      ...shaped(d),
      status: d.status,
      prospectId: d.prospectId ? oid(d.prospectId) : null,
      recordedBy: oidOrNull(d.recordedBy),
    }));
  }

  /** Admin review queue — oldest first (FIFO fairness on held signups), newest on request. */
  async listByStatus(status, limit = 50, skip = 0, q = '', sortDir = 1) {
    const filter = status === 'All' ? {} : { status };
    const query = String(q ?? '').trim();
    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.code = { $regex: escaped, $options: 'i' };
    }
    const dir = sortDir === -1 ? -1 : 1;
    const [docs, total] = await Promise.all([
      ReservationCodeModel.find(filter).sort({ createdAt: dir }).skip(skip).limit(limit).lean(),
      ReservationCodeModel.countDocuments(filter),
    ]);
    return {
      items: docs.map((d) => ({
        ...shaped(d),
        status: d.status,
        prospectId: d.prospectId ? oid(d.prospectId) : null,
      })),
      total,
    };
  }

  /** Status counts for the admin strip — one aggregation, no documents. */
  async statusSummary() {
    const rows = await ReservationCodeModel.aggregate([
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const out = { Pending: 0, Approved: 0, Rejected: 0, Used: 0 };
    for (const r of rows) {
      if (r._id in out) out[r._id] = r.n;
      else out[r._id] = r.n;
    }
    return out;
  }

  /**
   * Hard delete — Pending/Rejected always; Approved only while unconsumed;
   * Used never (signup and partner history reference it).
   */
  async hardDelete(id) {
    const doc = await ReservationCodeModel.findById(id).lean();
    if (!doc) return null;
    if (doc.status === 'Used') {
      const err = new Error('Used codes are history and cannot be deleted');
      err.code = 'CODE_USED';
      throw err;
    }
    await ReservationCodeModel.deleteOne({ _id: id });
    return { id: String(doc._id), code: doc.code, status: doc.status };
  }

  /**
   * Admin decision — moves within the caller-supplied `from` set only, so
   * double-clicks and replays can't move money-adjacent state twice.
   * Returns null when the row already left the expected state.
   */
  async decide(reservationId, status, from = ['Pending']) {
    const doc = await ReservationCodeModel.findOneAndUpdate(
      { _id: reservationId, status: { $in: from } },
      { $set: { status } },
      { new: true },
    ).lean();
    if (!doc) return null;
    return { ...shaped(doc), status: doc.status, prospectId: doc.prospectId ? oid(doc.prospectId) : null };
  }
}
