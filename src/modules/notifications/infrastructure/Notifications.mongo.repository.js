import mongoose from 'mongoose';

const readSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    itemId: { type: String, required: true },
    readAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
// One read-state row per item; rows auto-expire after 90 days.
readSchema.index({ partnerId: 1, itemId: 1 }, { unique: true });
readSchema.index({ readAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const NotificationReadModel =
  mongoose.models['Notification-read'] ?? mongoose.model('Notification-read', readSchema);

/** Mongo implementation of the read-state contract. */
export class MongoNotificationStore {
  async readIds(partnerId) {
    const docs = await NotificationReadModel.find({ partnerId }).select('itemId').lean();
    return new Set(docs.map((d) => d.itemId));
  }

  async markRead(partnerId, ids) {
    if (ids.length === 0) return { marked: 0 };
    const ops = ids.map((itemId) => ({
      updateOne: {
        filter: { partnerId, itemId },
        update: { $set: { readAt: new Date() } },
        upsert: true,
      },
    }));
    await NotificationReadModel.bulkWrite(ops, { ordered: false });
    return { marked: ids.length };
  }
}
