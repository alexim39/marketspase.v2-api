import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    category: { type: String, required: true, index: true },
    priority: { type: String, enum: ['critical', 'high', 'medium', 'low'], required: true, index: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },
    icon: { type: String, default: 'notifications', maxlength: 40 },
    link: { type: String, default: null, maxlength: 500 },
    // Producer idempotency key (N2 daily brief) — only set for keyed writes.
    key: { type: String, default: null, maxlength: 120 },
    // Per-channel delivery receipts (analytics) + click beacon timestamp.
    channels: {
      email: { type: Date, default: null },
      sms: { type: Date, default: null },
      push: { type: Date, default: null },
    },
    readAt: { type: Date, default: null },
    clickedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ recipientId: 1, archivedAt: 1, createdAt: -1 });
// Duplicate suppression: same producer key → same logical item, one row.
notificationSchema.index(
  { recipientId: 1, key: 1 },
  { unique: true, partialFilterExpression: { key: { $type: 'string' } } },
);
notificationSchema.index({ title: 'text', body: 'text' });

const preferenceSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, unique: true },
    channels: { type: Object, default: {} },
    emailDigest: { type: String, enum: ['immediate', 'daily', 'weekly', 'off'], default: 'immediate' },
    // N5 digest bookkeeping — last successful send per cadence (null = never).
    lastDailyDigestAt: { type: Date, default: null },
    lastWeeklyDigestAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);
preferenceSchema.index({ emailDigest: 1, partnerId: 1 });

const pushSubscriptionSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    endpoint: { type: String, required: true, maxlength: 2000 },
    p256dh: { type: String, required: true, maxlength: 500 },
    auth: { type: String, required: true, maxlength: 500 },
    userAgent: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
pushSubscriptionSchema.index({ partnerId: 1, endpoint: 1 }, { unique: true });

export const StoredNotificationModel =
  mongoose.models['Stored-notification'] ?? mongoose.model('Stored-notification', notificationSchema);
export const NotificationPreferenceModel =
  mongoose.models['Notification-preference'] ?? mongoose.model('Notification-preference', preferenceSchema);
export const PushSubscriptionModel =
  mongoose.models['Push-subscription'] ?? mongoose.model('Push-subscription', pushSubscriptionSchema);

const oid = (v) => String(v);
const shaped = (o) => (o ? { ...o, id: oid(o._id), recipientId: oid(o.recipientId) } : null);

/** Mongo implementation of the stored-notification contract. Reads use `.lean()`. */
export class MongoStoredNotificationStore {
  async create(data) {
    return shaped((await StoredNotificationModel.create(data)).toObject());
  }

  async findById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return shaped(await StoredNotificationModel.findById(id).lean());
  }

  async findByKey(recipientId, key) {
    if (!key) return null;
    return shaped(await StoredNotificationModel.findOne({ recipientId, key }).lean());
  }

  /** True when any `daily:<day>:*` slot already exists (rerun guard). */
  async hasBriefForDay(recipientId, day) {
    const exists = await StoredNotificationModel.exists({
      recipientId,
      key: { $gte: `daily:${day}:`, $lt: `daily:${day};` },
    });
    return exists !== null;
  }

  async list(partnerId, { unreadOnly = false, search = '', cursor = null, limit = 50 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const filter = { recipientId: partnerId, archivedAt: null };
    if (unreadOnly) filter.readAt = null;
    if (search) filter.$text = { $search: search };
    if (cursor) {
      const anchor = await StoredNotificationModel.findById(cursor).select('createdAt').lean();
      if (anchor) {
        filter.$or = [
          { createdAt: { $lt: anchor.createdAt } },
          { createdAt: anchor.createdAt, _id: { $lt: anchor._id } },
        ];
      }
    }
    const docs = await StoredNotificationModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(lim + 1)
      .lean();
    const hasMore = docs.length > lim;
    return { items: docs.slice(0, lim).map(shaped), hasMore };
  }

  async markRead(partnerId, id) {
    const doc = await StoredNotificationModel.findOneAndUpdate(
      { _id: id, recipientId: partnerId, archivedAt: null },
      { $set: { readAt: new Date() } },
      { new: true },
    ).lean();
    return shaped(doc);
  }

  async markUnread(partnerId, id) {
    const doc = await StoredNotificationModel.findOneAndUpdate(
      { _id: id, recipientId: partnerId, archivedAt: null },
      { $set: { readAt: null } },
      { new: true },
    ).lean();
    return shaped(doc);
  }

  /** Click beacon — implies read, stamps first click only. */
  async recordClick(partnerId, id) {
    const doc = await StoredNotificationModel.findOneAndUpdate(
      { _id: id, recipientId: partnerId, archivedAt: null },
      { $set: { readAt: new Date() } },
      { new: true },
    ).lean();
    if (!doc) return null;
    if (!doc.clickedAt) {
      const stamped = await StoredNotificationModel.findOneAndUpdate(
        { _id: id, clickedAt: null },
        { $set: { clickedAt: new Date() } },
        { new: true },
      ).lean();
      return shaped(stamped ?? doc);
    }
    return shaped(doc);
  }

  /** Per-channel delivery receipts for analytics. */
  async stampChannels(id, stamp) {
    await StoredNotificationModel.updateOne({ _id: id }, { $set: stamp }).catch(() => null);
    return { stamped: true };
  }

  async deleteAll(partnerId) {
    const res = await StoredNotificationModel.deleteMany({ recipientId: partnerId });
    return { deleted: res.deletedCount ?? 0 };
  }

  /**
   * Engagement rollup for analytics: sent / read / clicked per category
   * plus channel receipt counts, over the trailing window.
   */
  async engagementStats(partnerId, since) {
    const rows = await StoredNotificationModel.aggregate([
      { $match: { recipientId: new mongoose.Types.ObjectId(partnerId), createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$category',
          sent: { $sum: 1 },
          read: { $sum: { $cond: [{ $ne: ['$readAt', null] }, 1, 0] } },
          clicked: { $sum: { $cond: [{ $ne: ['$clickedAt', null] }, 1, 0] } },
          email: { $sum: { $cond: [{ $ne: ['$channels.email', null] }, 1, 0] } },
          sms: { $sum: { $cond: [{ $ne: ['$channels.sms', null] }, 1, 0] } },
          push: { $sum: { $cond: [{ $ne: ['$channels.push', null] }, 1, 0] } },
        },
      },
    ]);
    return rows.map((r) => ({
      category: r._id,
      sent: r.sent,
      read: r.read,
      clicked: r.clicked,
      channels: { email: r.email, sms: r.sms, push: r.push },
    }));
  }

  async markAllRead(partnerId) {
    const res = await StoredNotificationModel.updateMany(
      { recipientId: partnerId, archivedAt: null, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return { marked: res.modifiedCount ?? 0 };
  }

  async archive(partnerId, id) {
    const doc = await StoredNotificationModel.findOneAndUpdate(
      { _id: id, recipientId: partnerId, archivedAt: null },
      { $set: { archivedAt: new Date() } },
      { new: true },
    ).lean();
    return shaped(doc);
  }

  async archiveAll(partnerId) {
    const res = await StoredNotificationModel.updateMany(
      { recipientId: partnerId, archivedAt: null },
      { $set: { archivedAt: new Date() } },
    );
    return { archived: res.modifiedCount ?? 0 };
  }

  async remove(partnerId, id) {
    const res = await StoredNotificationModel.deleteOne({ _id: id, recipientId: partnerId });
    return { deleted: res.deletedCount > 0 };
  }

  async unreadCount(partnerId) {
    return StoredNotificationModel.countDocuments({ recipientId: partnerId, archivedAt: null, readAt: null });
  }

  async getPreferences(partnerId) {
    const doc = await NotificationPreferenceModel.findOne({ partnerId }).lean();
    return doc ? { channels: doc.channels ?? {}, emailDigest: doc.emailDigest ?? 'immediate' } : null;
  }

  async savePreferences(partnerId, prefs) {
    const doc = await NotificationPreferenceModel.findOneAndUpdate(
      { partnerId },
      { $set: { channels: prefs.channels ?? {}, emailDigest: prefs.emailDigest ?? 'immediate' } },
      { new: true, upsert: true },
    ).lean();
    return { channels: doc.channels ?? {}, emailDigest: doc.emailDigest ?? 'immediate' };
  }

  /** Partner ids subscribed to a digest cadence (cursor-pageable). */
  async listDigestSubscribers(digest, { cursor = null, limit = 200 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const filter = { emailDigest: digest };
    if (cursor) filter.partnerId = { $gt: cursor };
    const docs = await NotificationPreferenceModel.find(filter)
      .select('partnerId emailDigest lastDailyDigestAt lastWeeklyDigestAt')
      .sort({ partnerId: 1 })
      .limit(lim + 1)
      .lean();
    return {
      items: docs.slice(0, lim).map((d) => ({
        partnerId: oid(d.partnerId),
        lastDailyDigestAt: d.lastDailyDigestAt ?? null,
        lastWeeklyDigestAt: d.lastWeeklyDigestAt ?? null,
      })),
      hasMore: docs.length > lim,
    };
  }

  /** Unread, unarchived stored items since `since`, newest first. */
  async unreadSince(partnerId, since, limit = 50) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const docs = await StoredNotificationModel.find({
      recipientId: partnerId,
      archivedAt: null,
      readAt: null,
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(lim)
      .lean();
    return docs.map(shaped);
  }

  /** Upsert a push subscription (one row per device endpoint). */
  async saveSubscription(partnerId, { endpoint, p256dh, auth, userAgent = null }) {
    const doc = await PushSubscriptionModel.findOneAndUpdate(
      { partnerId, endpoint },
      { $set: { p256dh, auth, userAgent } },
      { new: true, upsert: true },
    ).lean();
    return { id: oid(doc._id), endpoint: doc.endpoint };
  }

  async removeSubscription(partnerId, endpoint) {
    const res = await PushSubscriptionModel.deleteOne({ partnerId, endpoint });
    return { deleted: res.deletedCount > 0 };
  }

  async pruneSubscription(partnerId, endpoint) {
    await PushSubscriptionModel.deleteOne({ partnerId, endpoint }).catch(() => null);
    return { pruned: true };
  }

  async listSubscriptions(partnerId) {
    const docs = await PushSubscriptionModel.find({ partnerId }).lean();
    return docs.map((d) => ({
      endpoint: d.endpoint,
      keys: { p256dh: d.p256dh, auth: d.auth },
    }));
  }

  /** Record a successful digest send (upserts the preference row). */
  async stampDigest(partnerId, kind, at = new Date()) {
    const field = kind === 'weekly' ? 'lastWeeklyDigestAt' : 'lastDailyDigestAt';
    await NotificationPreferenceModel.updateOne(
      { partnerId },
      { $set: { [field]: at } },
      { upsert: true },
    );
    return { stamped: field };
  }
}
