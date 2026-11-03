import mongoose from 'mongoose';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';

const messageSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    kind: { type: String, enum: ['direct', 'announcement', 'broadcast', 'team'], required: true, index: true },
    title: { type: String, default: '', maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },
    // Purpose-team channel only (direct/announcement/broadcast stay null).
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ recipientId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, createdAt: -1 });

export const MessageModel =
  mongoose.models.Message ?? mongoose.model('Message', messageSchema);

const oid = (v) => String(v);
const shaped = (o) => ({ ...o, id: oid(o._id), senderId: oid(o.senderId), recipientId: oid(o.recipientId) });

/** Directory-safe labels for sender/recipient columns. */
async function labels(ids) {
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return {};
  const docs = await PartnersModel.find({ _id: { $in: uniq } }).select('username name surname').lean();
  return Object.fromEntries(docs.map((d) => [oid(d._id), {
    username: d.username,
    name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
  }]));
}

const withLabels = async (docs) => {
  const map = await labels(docs.flatMap((d) => [d.senderId, d.recipientId]));
  return docs.map((d) => ({
    ...shaped(d),
    sender: map[oid(d.senderId)] ?? null,
    recipient: map[oid(d.recipientId)] ?? null,
  }));
};

/** Mongo implementation of the message store. Reads use `.lean()`. */
export class MongoMessageStore {
  async create(data) {
    return shaped((await MessageModel.create(data)).toObject());
  }

  async createMany(rows) {
    if (rows.length === 0) return { inserted: 0 };
    const docs = await MessageModel.insertMany(rows, { ordered: false });
    return { inserted: docs.length };
  }

  async inbox(partnerId, limit = 50) {
    const docs = await MessageModel.find({ recipientId: partnerId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return withLabels(docs);
  }

  async sent(partnerId, limit = 50) {
    const docs = await MessageModel.find({ senderId: partnerId, kind: { $in: ['direct', 'team'] } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return withLabels(docs);
  }

  async thread(partnerId, counterpartId, limit = 100, before = null) {
    const filter = {
      kind: 'direct',
      $or: [
        { senderId: partnerId, recipientId: counterpartId },
        { senderId: counterpartId, recipientId: partnerId },
      ],
    };
    if (before) {
      const at = new Date(before);
      if (!Number.isNaN(at.getTime())) filter.createdAt = { $lt: at };
    }
    // Newest-first window, returned chronological (mirrors group threads).
    // NB: withLabels is async — await before reversing, or this throws.
    const docs = await MessageModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return (await withLabels(docs)).reverse();
  }

  async findById(id) {
    const doc = await MessageModel.findById(id).lean();
    return doc ? shaped(doc) : null;
  }

  async markRead(id) {
    const doc = await MessageModel.findByIdAndUpdate(id, { $set: { readAt: new Date() } }, { new: true }).lean();
    return doc ? shaped(doc) : null;
  }

  async unreadCount(partnerId) {
    return MessageModel.countDocuments({ recipientId: partnerId, readAt: null });
  }
}
