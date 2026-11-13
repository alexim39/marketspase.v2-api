import mongoose from 'mongoose';

const featureEventSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    event: { type: String, required: true, trim: true, maxlength: 80, index: true },
    feature: { type: String, default: '', trim: true, maxlength: 60, index: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false, collection: 'product_events' },
);

featureEventSchema.index({ event: 1, createdAt: -1 });
featureEventSchema.index({ feature: 1, createdAt: -1 });
featureEventSchema.index({ createdAt: -1 });

export const FeatureEventModel =
  mongoose.models.FeatureEvent ?? mongoose.model('FeatureEvent', featureEventSchema);

const oid = (value) => String(value);

export class FeatureEventStore {
  async recordMany(partnerId, rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) return { recorded: 0 };
    const docs = rows.slice(0, 50).map((row) => ({
      partnerId,
      event: String(row?.event ?? '').trim().slice(0, 80),
      feature: String(row?.feature ?? '').trim().slice(0, 60),
      meta: row?.meta && typeof row.meta === 'object' ? row.meta : {},
      createdAt: new Date(),
    })).filter((row) => row.event);
    if (docs.length === 0) return { recorded: 0 };
    await FeatureEventModel.insertMany(docs, { ordered: false });
    return { recorded: docs.length };
  }

  async byEventSince(since) {
    const rows = await FeatureEventModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$event',
          count: { $sum: 1 },
          partners: { $addToSet: '$partnerId' },
        },
      },
      { $project: { _id: 0, event: '$_id', count: 1, partners: { $size: '$partners' } } },
      { $sort: { count: -1 } },
    ]);
    return rows.map((row) => ({ event: String(row.event), count: Number(row.count) || 0, partners: Number(row.partners) || 0 }));
  }

  async byFeatureSince(since) {
    const rows = await FeatureEventModel.aggregate([
      { $match: { createdAt: { $gte: since }, feature: { $ne: '' } } },
      {
        $group: {
          _id: '$feature',
          count: { $sum: 1 },
          partners: { $addToSet: '$partnerId' },
        },
      },
      { $project: { _id: 0, feature: '$_id', count: 1, partners: { $size: '$partners' } } },
      { $sort: { count: -1 } },
    ]);
    return rows.map((row) => ({ feature: String(row.feature), count: Number(row.count) || 0, partners: Number(row.partners) || 0 }));
  }

  async totalSince(since) {
    const rows = await FeatureEventModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: null, count: { $sum: 1 }, partners: { $addToSet: '$partnerId' } } },
      { $project: { _id: 0, count: 1, partners: { $size: '$partners' } } },
    ]);
    return { count: Number(rows[0]?.count ?? 0), partners: Number(rows[0]?.partners ?? 0) };
  }

  async latest(limit = 50) {
    const rows = await FeatureEventModel.find({}).sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 100)).lean();
    return rows.map((row) => ({
      id: oid(row._id),
      partnerId: oid(row.partnerId),
      event: row.event,
      feature: row.feature,
      meta: row.meta ?? {},
      createdAt: row.createdAt,
    }));
  }
}
