import mongoose from 'mongoose';

const goalSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    title: { type: String, default: '', trim: true, maxlength: 120 },
    kind: { type: String, required: true, index: true },
    target: { type: Number, required: true, min: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // Manual lifecycle — auto Complete stays derived (current >= target).
    // Closed = user declared done/abandoned; old docs default to active.
    status: { type: String, enum: ['active', 'closed'], default: 'active', index: true },
    closedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: String, default: null },
  },
  { timestamps: true },
);

goalSchema.index({ partnerId: 1, createdAt: -1 });

export const GoalModel = mongoose.models.Goal ?? mongoose.model('Goal', goalSchema);

const oid = (v) => String(v);

/** Mongo implementation of the goal store. */
export class MongoGoalStore {
  async create(data) {
    const doc = await GoalModel.create(data);
    const o = doc.toObject();
    return { ...o, id: oid(o._id) };
  }

  async findById(id) {
    const doc = await GoalModel.findOne({ _id: id, deletedAt: null }).lean();
    return doc ? { ...doc, id: oid(doc._id) } : null;
  }

  async listByPartner(partnerId) {
    const docs = await GoalModel.find({ partnerId, deletedAt: null }).sort({ endDate: 1 }).lean();
    return docs.map((d) => ({ ...d, id: oid(d._id) }));
  }

  async updateById(id, patch) {
    const doc = await GoalModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: patch },
      { new: true },
    ).lean();
    return doc ? { ...doc, id: oid(doc._id) } : null;
  }

  async deleteById(id, deletedBy = null) {
    const doc = await GoalModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy: deletedBy ? String(deletedBy) : null } },
      { new: true },
    ).lean();
    return doc !== null;
  }
}
