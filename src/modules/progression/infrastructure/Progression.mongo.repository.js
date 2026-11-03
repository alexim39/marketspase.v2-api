import mongoose from 'mongoose';

const stampSchema = new mongoose.Schema(
  {
    done: { type: Boolean, default: false },
    at: { type: Date, default: null },
    // Training confirmation (abuse-proofing): done = member marked it,
    // confirmedAt/by = upline verified it. Gates check confirmed, not done.
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    confirmedAt: { type: Date, default: null },
  },
  { _id: false },
);

const progressionSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, unique: true },
    /** Last derived level (refreshed on read; distribution reads this). */
    level: { type: String, default: 'partner', index: true },
    levelAt: { type: Date, default: null },
    ipo: { type: stampSchema, default: () => ({}) },
    qsg: { type: stampSchema, default: () => ({}) },
    smo: { type: stampSchema, default: () => ({}) },
    accounts: {
      count: { type: Number, default: 0, min: 0 },
      refs: { type: [String], default: [] },
      maintenanceRef: { type: String, default: '' },
      maintenanceMonth: { type: String, default: '' },
      done: { type: Boolean, default: false },
      at: { type: Date, default: null },
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
      confirmedAt: { type: Date, default: null },
    },
    maintenance: {
      done: { type: Boolean, default: false },
      at: { type: Date, default: null },
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
      confirmedAt: { type: Date, default: null },
      ref: { type: String, default: '' },
      month: { type: String, default: '' },
    },
    fullTime: { type: stampSchema, default: () => ({}) },
    office: { type: stampSchema, default: () => ({}) },
    officeAddress: { type: String, default: '' },
    g8Request: { status: { type: String, enum: ['none', 'submitted', 'approved'], default: 'none' }, at: { type: Date, default: null } },
    onboardingSession: { type: stampSchema, default: () => ({}) },
    qualifiedConfirmed: { type: stampSchema, default: () => ({}) },
    nomination: {
      status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
      note: { type: String, default: '', maxlength: 500 },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
      at: { type: Date, default: null },
      // Counted G8 approvals — distinct approvers, threshold in levels.js.
      approvals: [{
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
        at: { type: Date, default: Date.now },
        _id: false,
      }],
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
      decidedAt: { type: Date, default: null },
    },
    appointment: { type: stampSchema, default: () => ({}) },
    appointedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    /** Audit trail of milestone changes (capped). */
    events: [{
      at: { type: Date, default: Date.now },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
      key: { type: String },
      _id: false,
    }],
  },
  { timestamps: true },
);

export const ProgressionModel =
  mongoose.models.Progression ?? mongoose.model('Progression', progressionSchema);

const oid = (v) => String(v);
const shaped = (o) => (o ? { ...o, id: oid(o._id), partnerId: oid(o.partnerId) } : null);

/** Mongo implementation of the progression store. Reads use `.lean()`. */
export class MongoProgressionStore {
  async findByPartner(partnerId) {
    return shaped(await ProgressionModel.findOne({ partnerId }).lean());
  }

  async ensure(partnerId) {
    return shaped(await ProgressionModel.findOneAndUpdate(
      { partnerId },
      { $setOnInsert: { partnerId, level: 'partner' } },
      { new: true, upsert: true },
    ).lean());
  }

  async upsertMilestones(partnerId, patch, event) {
    const row = await ProgressionModel.findOneAndUpdate(
      { partnerId },
      {
        $set: patch,
        $push: { events: { $each: [event], $slice: -100 } },
      },
      { new: true, upsert: true },
    ).lean();
    return shaped(row);
  }

  /**
   * Member marks training done → pending upline confirmation. Idempotent:
   * re-marking an already-pending stamp just refreshes its timestamp
   * (no duplicate notifications — the event fires on transition only,
   * decided in the use case).
   */
  async requestTrainingConfirm(partnerId, key) {
    const doc = await ProgressionModel.findOneAndUpdate(
      { partnerId },
      {
        $set: { [`${key}.done`]: true, [`${key}.at`]: new Date(), [`${key}.confirmedBy`]: null, [`${key}.confirmedAt`]: null },
        $push: { events: { $each: [{ at: new Date(), by: partnerId, key: `${key}:requested` }], $slice: -100 } },
      },
      { new: true, upsert: true },
    ).lean();
    return shaped(doc);
  }

  /**
   * Upline decision on a pending training stamp. Approve stamps the
   * confirmation; decline resets the stamp so the member can re-mark
   * after genuinely completing (the decline note travels by
   * notification, not storage).
   */
  async confirmTraining(partnerId, key, approverId, approved) {
    const filter = approved
      ? { partnerId, [`${key}.done`]: true, [`${key}.confirmedAt`]: null }
      : { partnerId, [`${key}.done`]: true };
    const update = approved
      ? {
        $set: { [`${key}.confirmedBy`]: approverId, [`${key}.confirmedAt`]: new Date() },
        $push: { events: { $each: [{ at: new Date(), by: approverId, key: `${key}:confirmed` }], $slice: -100 } },
      }
      : {
        $set: { [`${key}.done`]: false, [`${key}.at`]: null, [`${key}.confirmedBy`]: null, [`${key}.confirmedAt`]: null },
        $push: { events: { $each: [{ at: new Date(), by: approverId, key: `${key}:declined` }], $slice: -100 } },
      };
    const row = await ProgressionModel.findOneAndUpdate(filter, update, { new: true }).lean();
    return shaped(row);
  }

  /** Downline training stamps awaiting confirmation (bounded). */
  async listPendingConfirmations(partnerIds, keys, limit = 100) {
    if (partnerIds.length === 0 || keys.length === 0) return [];
    const or = keys.map((k) => ({ [`${k}.done`]: true, [`${k}.confirmedAt`]: null }));
    const rows = await ProgressionModel.find({ partnerId: { $in: partnerIds }, $or: or })
      .select('partnerId level ipo qsg smo fullTime office onboardingSession accounts maintenance updatedAt')
      .sort({ updatedAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 200))
      .lean();
    return rows.map(shaped);
  }

  /** Confirmation stamps across a bounded id set (stats read-model). */
  async listConfirmationStats(partnerIds, keys) {
    if (partnerIds.length === 0 || keys.length === 0) return [];
    const fields = ['partnerId level updatedAt'];
    for (const k of keys) fields.push(`${k}.done`, `${k}.at`, `${k}.confirmedBy`, `${k}.confirmedAt`);
    const rows = await ProgressionModel.find({ partnerId: { $in: partnerIds } })
      .select(fields.join(' '))
      .sort({ updatedAt: -1 })
      .limit(2000)
      .lean();
    return rows.map(shaped);
  }

  /**
   * Own confirmations decided since `since`: [{at, confirmedAt}] for the
   * responsiveness leg. Bounded; sparse confirmedBy legs live in the manifest.
   */
  async decisionsByApprover(approverId, since) {
    const keys = ['ipo', 'qsg', 'smo', 'fullTime', 'office', 'onboardingSession', 'accounts', 'maintenance'];
    const rows = await ProgressionModel.find({
      $or: keys.map((k) => ({
        [`${k}.confirmedBy`]: approverId,
        [`${k}.confirmedAt`]: { $gte: since },
      })),
    })
      .select('ipo qsg smo fullTime office onboardingSession accounts maintenance')
      .limit(500)
      .lean();
    const out = [];
    for (const r of rows) {
      for (const k of keys) {
        const s = r[k];
        if (String(s?.confirmedBy ?? '') === String(approverId) && s?.confirmedAt && s?.at) {
          out.push({ at: s.at, confirmedAt: s.confirmedAt });
        }
      }
    }
    return out;
  }
  async setLevel(partnerId, level) {
    const row = await ProgressionModel.findOneAndUpdate(
      { partnerId },
      { $set: { level, levelAt: new Date() } },
      { new: true, upsert: true },
    ).lean();
    return shaped(row);
  }

  /** IPO confirmation stamp per partner: {partnerId: ms|null} (one query).
   * Confirmed-only (matches the ladder gates) — member-marked but
   * unconfirmed claims do not count. */
  async trainingDates(ids) {
    if (ids.length === 0) return {};
    const rows = await ProgressionModel.find({ partnerId: { $in: ids } })
      .select('partnerId ipo')
      .lean();
    return Object.fromEntries(rows.map((r) => [
      String(r.partnerId),
      r.ipo?.done === true && r.ipo?.confirmedAt ? new Date(r.ipo.confirmedAt).getTime() : null,
    ]));
  }
  /** Stored levels for a bounded id set (distribution reads this). */
  async levelsFor(partnerIds) {
    if (partnerIds.length === 0) return {};
    const rows = await ProgressionModel.find({ partnerId: { $in: partnerIds } })
      .select('partnerId level')
      .lean();
    return Object.fromEntries(rows.map((r) => [oid(r.partnerId), r.level ?? 'partner']));
  }

  /** Org-wide journey-rank distribution (indexed `level` leg, one aggregation). */
  async levelDistribution() {
    const rows = await ProgressionModel.aggregate([
      { $group: { _id: { $ifNull: ['$level', 'partner'] }, count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
  }

  async requestNomination(partnerId, note) {
    const row = await ProgressionModel.findOneAndUpdate(
      { partnerId },
      { $set: { nomination: { status: 'pending', note, by: partnerId, at: new Date(), approvals: [], decidedBy: null, decidedAt: null } } },
      { new: true, upsert: true },
    ).lean();
    return shaped(row);
  }

  /**
   * One approval from a distinct G8/admin approver (`$ne` guard makes
   * concurrent double-approvals impossible). Flips to approved at the
   * required count. Returns `{doc, duplicate}` — null doc = nothing pending.
   */
  async approveNomination(partnerId, approverId, required) {
    const before = await ProgressionModel.findOne({ partnerId }).lean();
    if (!before || before.nomination?.status !== 'pending') return null;
    const duplicate = (before.nomination.approvals ?? []).some((a) => String(a.by) === String(approverId));
    if (!duplicate) {
      await ProgressionModel.updateOne(
        { partnerId, 'nomination.status': 'pending', 'nomination.approvals.by': { $ne: approverId } },
        { $push: { 'nomination.approvals': { by: approverId, at: new Date() } } },
      );
    }
    const after = await ProgressionModel.findOne({ partnerId }).lean();
    const count = after?.nomination?.approvals?.length ?? 0;
    if (!duplicate && after?.nomination?.status === 'pending' && count >= required) {
      await ProgressionModel.updateOne(
        { partnerId },
        { $set: { 'nomination.status': 'approved', 'nomination.decidedAt': new Date() } },
      );
      after.nomination.status = 'approved';
    }
    return { doc: shaped(after), duplicate };
  }

  async rejectNomination(partnerId, decidedBy) {
    const row = await ProgressionModel.findOneAndUpdate(
      { partnerId, 'nomination.status': 'pending' },
      { $set: { 'nomination.status': 'rejected', 'nomination.decidedBy': decidedBy, 'nomination.decidedAt': new Date() } },
      { new: true },
    ).lean();
    return shaped(row);
  }

  /** Pending G-nominations within a bounded id set (oversight inbox). */
  async listPendingNominations(partnerIds, limit = 100) {
    // Null ids = org-wide (admin oversight); empty array = nobody.
    const filter = partnerIds === null
      ? { 'nomination.status': 'pending' }
      : { partnerId: { $in: partnerIds }, 'nomination.status': 'pending' };
    if (partnerIds !== null && partnerIds.length === 0) return [];
    const rows = await ProgressionModel.find(filter)
      .select('partnerId level nomination updatedAt')
      .sort({ updatedAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 200))
      .lean();
    return rows.map(shaped);
  }
}
