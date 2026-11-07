import mongoose from 'mongoose';
import { ProspectModel, PartnersModel } from './Prospect.models.js';
import { ProspectMapper } from './Prospect.mapper.js';
import { normalizePhone } from '../domain/Prospect.entity.js';

/**
 * Aggregations do NOT auto-cast strings to ObjectIds (unlike `find`).
 * Prospects store `partnerId` as ObjectId, but callers pass session strings —
 * matching a raw string against ObjectIds returns zero rows, which is why
 * submitted lists saved fine yet the downline page stayed empty.
 * Match both forms so ObjectId rows and any legacy string rows all hit.
 */
const objectIdOrNull = (value) => {
  try {
    const s = String(value ?? '').trim();
    if (!/^[a-fA-F0-9]{24}$/.test(s)) return null;
    return new mongoose.Types.ObjectId(s);
  } catch {
    return null;
  }
};

const matchPartnerIds = (ids) => {
  const list = (Array.isArray(ids) ? ids : [ids]).map((v) => String(v ?? '').trim()).filter(Boolean);
  const forms = [];
  for (const s of list) {
    forms.push(s);
    const oid = objectIdOrNull(s);
    if (oid) forms.push(oid);
  }
  return [...new Set(forms)];
};

/** Mongo implementation of the crm repository contracts. Reads use `.lean()`. */
export class MongoProspectRepository {
  async create(data) {
    const doc = await ProspectModel.create(ProspectMapper.toPersistence(data));
    return ProspectMapper.toDomain(doc);
  }

  async findById(id) {
    return ProspectMapper.toDomain(
      await ProspectModel.findOne({ _id: id, deletedAt: null }).lean(),
    );
  }

  async findByPartnerId(partnerId, { limit = 100, skip = 0, q, stage, ids } = {}) {
    const base = { partnerId, deletedAt: null };
    if (q) {
      const escaped = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      base.$or = [{ prospectName: re }, { prospectSurname: re }, { prospectPhone: re }, { prospectEmail: re }];
    }
    if (Array.isArray(ids) && ids.length > 0) {
      base._id = { $in: ids };
    }
    const filter = { ...base };
    if (stage) filter['status.stage'] = stage;
    const [items, total, stageRows] = await Promise.all([
      ProspectModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ProspectModel.countDocuments(filter),
      ProspectModel.aggregate([
        { $match: base },
        { $group: { _id: { $ifNull: ['$status.stage', 'New'] }, count: { $sum: 1 } } },
      ]),
    ]);
    return {
      items: items.map(ProspectMapper.toDomain),
      total,
      stageCounts: Object.fromEntries(stageRows.map((row) => [row._id, row.count])),
    };
  }

  /** Goal-engine counters: created + converted within a window. */
  async countCreated(partnerId, start, end) {
    return ProspectModel.countDocuments({ partnerId, deletedAt: null, createdAt: { $gte: start, $lte: end } });
  }

  /** Generic counter passthrough (Member 360 growth reads). */
  async countDocuments(filter) {
    return ProspectModel.countDocuments({ ...filter, deletedAt: null });
  }

  /** Bounded prospect reads passthrough (Member 360 growth reads). */
  async find(filter) {
    return ProspectModel.find({ ...filter, deletedAt: null });
  }

  /** Earliest prospect per partner: {partnerId: ms} (one aggregate). */
  async firstProspectDates(ids) {
    if (ids.length === 0) return {};
    const rows = await ProspectModel.aggregate([
      { $match: { partnerId: { $in: ids.map(String) }, deletedAt: null } },
      { $group: { _id: '$partnerId', firstAt: { $min: '$createdAt' } } },
    ]);
    return Object.fromEntries(rows.map((r) => [String(r._id), new Date(r.firstAt).getTime()]));
  }
  async countConverted(partnerId, start, end) {
    return ProspectModel.countDocuments({
      partnerId,
      deletedAt: null,
      'status.stage': 'Converted',
      updatedAt: { $gte: start, $lte: end },
    });
  }

  /** Prospects touched (any communication logged) since `since` — leadership signal. */
  async countTouchedSince(partnerId, since) {
    return ProspectModel.countDocuments({
      partnerId,
      deletedAt: null,
      communications: { $elemMatch: { date: { $gte: since } } },
    });
  }

  /**
   * Cohort funnel: prospects created in-window grouped by current stage.
   * Documents without a stage overlay (legacy) count as 'New'.
   */
  async stageDistribution(partnerId, start, end) {
    const rows = await ProspectModel.aggregate([
      { $match: { partnerId, deletedAt: null, createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: { $ifNull: ['$status.stage', 'New'] }, count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [r._id, r.count]));
  }

  /** Org-wide funnel: same shape, no partner filter (admin console). */
  async orgStageDistribution(start, end) {
    const rows = await ProspectModel.aggregate([
      { $match: { deletedAt: null, createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: { $ifNull: ['$status.stage', 'New'] }, count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [r._id, r.count]));
  }

  /**
   * Follow-up commitments due: prospects whose LATEST open touch carries a
   * followUpDate within the window (overdue + today + upcoming). Terminal
   * stages excluded. Bounded, soonest first. A fresh touch without a
   * followUpDate naturally drops the prospect out (mark-done by doing).
   */
  async findDueFollowUps(partnerId, now = new Date(), { withinDays = 7, limit = 200 } = {}) {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + Math.min(Math.max(Number(withinDays) || 7, 1), 30) + 1);
    const rows = await ProspectModel.aggregate([
      { $match: { partnerId, deletedAt: null } },
      { $match: { 'status.stage': { $nin: ['Converted', 'Closed'] } } },
      { $addFields: { __last: { $last: '$communications' } } },
      { $match: { '__last.followUpDate': { $ne: null, $lte: end } } },
      { $sort: { '__last.followUpDate': 1 } },
      { $limit: Math.min(Math.max(Number(limit) || 200, 1), 500) },
      { $project: { __last: 0 } },
    ]);
    return rows.map(ProspectMapper.toDomain);
  }

  /** Hottest pipeline: currently in negotiation, most recently touched first. */
  async findReadyToConvert(partnerId, limit = 5) {
    const docs = await ProspectModel.find({ partnerId, deletedAt: null, 'status.stage': 'In Negotiation' })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    return docs.map(ProspectMapper.toDomain);
  }

  async findDuplicate(partnerId, { phone, email }) {
    const normalizedPhone = phone ? normalizePhone(phone) : null;
    const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
    if (!normalizedPhone && !normalizedEmail) return null;
    // Normalize-aware check: fetch partner's phones/emails and compare in memory
    // so "0803 123 4567" and "08031234567" collide correctly, and legacy
    // spaced values still match. Bounded by partner (hundreds, not thousands).
    const docs = await ProspectModel.find({ partnerId, deletedAt: null }).select('prospectPhone prospectEmail').lean();
    const hit = docs.find((d) => {
      if (normalizedPhone && normalizePhone(d.prospectPhone ?? '') === normalizedPhone) return true;
      if (normalizedEmail && d.prospectEmail && String(d.prospectEmail).trim().toLowerCase() === normalizedEmail) return true;
      return false;
    });
    return hit ? ProspectMapper.toDomain(await ProspectModel.findById(hit._id).lean()) : null;
  }

  async updateFields(id, patch) {
    if (Object.keys(patch).length === 0) return this.findById(id);
    return ProspectMapper.toDomain(
      await ProspectModel.findOneAndUpdate(
        { _id: id, deletedAt: null },
        { $set: patch },
        { new: true, runValidators: true },
      ).lean(),
    );
  }

  async updateStatus(id, overlay, author = {}) {
    const dotted = Object.fromEntries(Object.entries(overlay).map(([k, v]) => [`status.${k}`, v]));
    dotted['status.updatedAt'] = new Date();
    const update = { $set: dotted };
    // Stage-move audit: record from → to with actor (stage advances and
    // conversions share this path, so both are captured). Non-stage updates
    // (notes, dates) and no-op rewrites leave history alone.
    const to = overlay?.stage;
    if (to) {
      const current = await ProspectModel.findOne({ _id: id, deletedAt: null }).select('status.stage').lean().catch(() => null);
      const from = current?.status?.stage ?? null;
      if (from !== to) {
        update.$push = {
          stageHistory: {
            from,
            to,
            at: overlay.stageEnteredAt ?? new Date(),
            ...(author?.by ? { by: String(author.by).slice(0, 40) } : {}),
            ...(author?.byName ? { byName: String(author.byName).slice(0, 120) } : {}),
          },
        };
      }
    }
    return ProspectMapper.toDomain(
      await ProspectModel.findOneAndUpdate(
        { _id: id, deletedAt: null },
        update,
        { new: true, runValidators: true },
      ).lean(),
    );
  }

  async pushCommunication(id, communication) {
    return ProspectMapper.toDomain(
      await ProspectModel.findOneAndUpdate(
        { _id: id, deletedAt: null },
        { $push: { communications: communication } },
        { new: true, runValidators: true },
      ).lean(),
    );
  }

  async pullCommunication(prospectId, communicationId) {
    const prospect = ProspectMapper.toDomain(
      await ProspectModel.findOneAndUpdate(
        { _id: prospectId, deletedAt: null },
        { $pull: { communications: { _id: communicationId } } },
        { new: true },
      ).lean(),
    );
    if (!prospect) return { prospect: null, removed: false };
    const removed = !prospect.communications.some((c) => String(c._id ?? c.id) === String(communicationId));
    return { prospect, removed };
  }

  async deleteById(id) {
    const doc = await ProspectModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { new: true },
    ).lean();
    return doc !== null;
  }

  /** GDPR erasure helper — count of owned prospects removed. */
  async deleteByPartner(partnerId) {
    const res = await ProspectModel.deleteMany({ partnerId });
    return res.deletedCount ?? 0;
  }

  /** Unsubmitted onboarding-list rows, oldest first. */
  async listUnsubmitted(partnerId) {
    const docs = await ProspectModel.find({ partnerId, deletedAt: null, listSubmitted: { $ne: true } })
      .sort({ createdAt: 1 })
      .lean();
    return docs.map(ProspectMapper.toDomain);
  }

  /** Submitted batches with per-stage progress, newest batch first. */
  async submittedBatches(partnerId) {
    const rows = await ProspectModel.aggregate([
      { $match: { partnerId: { $in: matchPartnerIds(partnerId) }, deletedAt: null, listSubmitted: true } },
      {
        $group: {
          _id: '$listBatch',
          count: { $sum: 1 },
          submittedAt: { $max: '$listSubmittedAt' },
          stages: { $push: { $ifNull: ['$status.stage', 'New'] } },
        },
      },
      { $sort: { submittedAt: -1 } },
    ]);
    return rows.map((r) => {
      const stageCounts = {};
      for (const s of r.stages) stageCounts[s] = (stageCounts[s] ?? 0) + 1;
      return {
        batch: r._id ?? 'legacy',
        submittedAt: r.submittedAt,
        total: r.count,
        stageCounts,
        worked: r.count - (stageCounts.New ?? 0),
      };
    });
  }

  /**
   * Stamp every unsubmitted row as one submitted batch. Returns the count
   * stamped (0 when there is nothing to submit — the use case enforces
   * the minimum before calling).
   */
  async submitContactList(partnerId, batch) {
    const now = new Date();
    const res = await ProspectModel.updateMany(
      { partnerId, listSubmitted: { $ne: true } },
      { $set: { listSubmitted: true, listSubmittedAt: now, listBatch: batch } },
    );
    return { count: res.modifiedCount ?? 0, submittedAt: now };
  }

  /** Submitted contact rows across partners, oldest first (bounded). */
  async submittedContacts(partnerIds, limit = 500) {
    if (partnerIds.length === 0) return [];
    const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);
    const docs = await ProspectModel.find({ partnerId: { $in: matchPartnerIds(partnerIds) }, listSubmitted: true })
      .select('partnerId prospectName prospectSurname prospectPhone relationship priority bestTimeToCall consentToContact listBatch status createdAt')
      .sort({ createdAt: 1 })
      .limit(lim)
      .lean();
    return docs.map(ProspectMapper.toDomain);
  }

  /** Resolve a scoped prospect by phone without returning the phone itself. */
  async findByPhoneInPartners(partnerIds, phone, limit = 3) {
    if (!partnerIds.length) return [];
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    const docs = await ProspectModel.find({
      partnerId: { $in: matchPartnerIds(partnerIds) },
      prospectPhone: normalized,
    }).select('_id partnerId').limit(Math.min(Math.max(Number(limit) || 3, 1), 10)).lean();
    return docs.map((doc) => ({ prospectId: String(doc._id), partnerId: String(doc.partnerId) }));
  }

  /** Submitted batches across many partners (upline view, bounded). */
  async downlineSubmittedBatches(partnerIds, cap = 200) {
    if (partnerIds.length === 0) return [];
    const lim = Math.min(Math.max(Number(cap) || 200, 1), 5000);
    const rows = await ProspectModel.aggregate([
      { $match: { partnerId: { $in: matchPartnerIds(partnerIds) }, listSubmitted: true } },
      {
        $group: {
          _id: { partnerId: '$partnerId', batch: '$listBatch' },
          count: { $sum: 1 },
          submittedAt: { $max: '$listSubmittedAt' },
          stages: { $push: { $ifNull: ['$status.stage', 'New'] } },
        },
      },
      { $sort: { submittedAt: -1 } },
      { $limit: lim },
    ]);
    return rows.map((r) => {
      const stageCounts = {};
      for (const s of r.stages) stageCounts[s] = (stageCounts[s] ?? 0) + 1;
      return {
        partnerId: String(r._id.partnerId),
        batch: r._id.batch ?? 'legacy',
        submittedAt: r.submittedAt,
        total: r.count,
        stageCounts,
        worked: r.count - (stageCounts.New ?? 0),
      };
    });
  }
}

export class MongoPartnerLookup {
  async exists(partnerId) {
    return (await PartnersModel.exists({ _id: partnerId })) !== null;
  }
}


