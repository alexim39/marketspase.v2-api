import mongoose from 'mongoose';

/**
 * Materialized 30-day team metrics, rebuilt nightly. The team endpoint
 * prefers a fresh snapshot (<36h) and computes live otherwise — same
 * shape either way, plus a `source` flag for transparency.
 */
const snapshotSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, unique: true },
    computedAt: { type: Date, required: true },
    windowDays: { type: Number, required: true, default: 30 },
    downlineTotal: { type: Number, required: true, default: 0 },
    active: { type: Number, required: true, default: 0 },
    recruits: { type: Number, required: true, default: 0 },
    prevRecruits: { type: Number, required: true, default: 0 },
    teamVolume: { type: Number, required: true, default: 0 },
    prevTeamVolume: { type: Number, required: true, default: 0 },
    personalVolume: { type: Number, required: true, default: 0 },
    personalOrders: { type: Number, required: true, default: 0 },
    conversions: { type: Number, required: true, default: 0 },
  },
  { timestamps: false },
);

export const TeamSnapshotModel =
  mongoose.models['Team-snapshot'] ?? mongoose.model('Team-snapshot', snapshotSchema);

const oid = (v) => String(v);
const shaped = (o) => ({ ...o, id: oid(o._id), partnerId: oid(o.partnerId) });

/** Mongo implementation of the snapshot store. */
export class MongoTeamSnapshotStore {
  async upsert(partnerId, doc) {
    const row = await TeamSnapshotModel.findOneAndUpdate(
      { partnerId },
      { $set: { ...doc, partnerId, computedAt: new Date() } },
      { new: true, upsert: true },
    ).lean();
    return shaped(row);
  }

  /** Fresh snapshot or null (caller falls back to live computation). */
  async findFresh(partnerId, windowDays = 30, maxAgeHours = 36) {
    const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000);
    const row = await TeamSnapshotModel.findOne({
      partnerId, windowDays, computedAt: { $gte: cutoff },
    }).lean();
    return row ? shaped(row) : null;
  }
}
