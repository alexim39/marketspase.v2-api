import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 8000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    title: { type: String, default: 'New conversation', maxlength: 120 },
    messages: { type: [messageSchema], default: [] },
    pinned: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);
conversationSchema.index({ partnerId: 1, updatedAt: -1 });

const oraEventSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ora-conversation', required: true },
    topic: { type: String, required: true, maxlength: 20 },
    messageChars: { type: Number, default: 0 },
    replyChars: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);
oraEventSchema.index({ partnerId: 1, at: -1 });

export const OraConversationModel =
  mongoose.models['Ora-conversation'] ?? mongoose.model('Ora-conversation', conversationSchema);
export const OraEventModel =
  mongoose.models['Ora-event'] ?? mongoose.model('Ora-event', oraEventSchema);

const MAX_MESSAGES = 100;

const oid = (v) => String(v);
const shaped = (o) => (o ? { ...o, id: oid(o._id), partnerId: oid(o.partnerId) } : null);

/** Mongo implementation of the ora conversation contract. Reads use `.lean()`. */
export class MongoOraConversationStore {
  async create(partnerId, title) {
    const clean = String(title ?? '').trim().slice(0, 120) || 'New conversation';
    return shaped((await OraConversationModel.create({ partnerId, title: clean })).toObject());
  }

  async findById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return shaped(await OraConversationModel.findById(id).lean());
  }

  async listByPartner(partnerId, opts = 20) {
    const { limit = 20, q = '' } = typeof opts === 'number' ? { limit: opts } : (opts ?? {});
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const filter = { partnerId };
    const needle = String(q ?? '').trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (needle) filter.title = { $regex: needle, $options: 'i' };
    const docs = await OraConversationModel.find(filter)
      .select('title pinned updatedAt createdAt')
      .sort({ pinned: -1, updatedAt: -1 })
      .limit(lim)
      .lean();
    return docs.map(shaped);
  }

  async setPinned(partnerId, id, pinned) {
    const doc = await OraConversationModel.findOneAndUpdate(
      { _id: id, partnerId },
      { $set: { pinned: pinned === true } },
      { new: true },
    ).lean();
    return shaped(doc);
  }

  /** Appends one message; trims oldest beyond the cap so history stays bounded. */
  async appendMessage(id, message) {
    const doc = await OraConversationModel.findOneAndUpdate(
      { _id: id },
      { $push: { messages: { $each: [message], $slice: -MAX_MESSAGES } } },
      { new: true },
    ).lean();
    return shaped(doc);
  }

  async remove(partnerId, id) {
    const res = await OraConversationModel.deleteOne({ _id: id, partnerId });
    return { deleted: res.deletedCount > 0 };
  }
}

const oraActionSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ora-conversation', default: null, index: true },
    opportunityId: { type: String, default: null, maxlength: 120 },
    type: {
      type: String,
      enum: ['send_sms', 'send_email', 'schedule_followup', 'advance_stage'],
      required: true,
    },
    capabilityKey: { type: String, default: null, maxlength: 80 },
    area: { type: String, default: '', maxlength: 40 },
    title: { type: String, default: '', maxlength: 160 },
    label: { type: String, default: '', maxlength: 60 },
    summary: { type: String, default: '', maxlength: 220 },
    link: { type: String, default: '', maxlength: 200 },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['proposed', 'executing', 'executed', 'skipped', 'failed'],
      default: 'proposed',
      index: true,
    },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null, maxlength: 500 },
    approvedAt: { type: Date, default: null },
    executedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);
oraActionSchema.index({ partnerId: 1, status: 1, createdAt: -1 });

export const OraActionModel =
  mongoose.models['Ora-action'] ?? mongoose.model('Ora-action', oraActionSchema);

const shapedAction = (row) => (row ? {
  id: oid(row._id),
  partnerId: oid(row.partnerId),
  conversationId: row.conversationId ? oid(row.conversationId) : null,
  opportunityId: row.opportunityId ?? null,
  type: row.type,
  capabilityKey: row.capabilityKey ?? null,
  area: row.area ?? '',
  title: row.title ?? '',
  label: row.label || row.title || 'Ora action',
  summary: row.summary ?? '',
  link: row.link ?? '',
  payload: row.payload ?? {},
  status: row.status ?? 'proposed',
  result: row.result ?? null,
  error: row.error ?? null,
  approvedAt: row.approvedAt ?? null,
  executedAt: row.executedAt ?? null,
  createdAt: row.createdAt ?? null,
  requiresApproval: true,
} : null);

/** Mongo implementation of the ora action/approval contract. */
export class MongoOraActionStore {
  async create(action) {
    const doc = await OraActionModel.create({
      partnerId: action.partnerId,
      conversationId: action.conversationId ?? null,
      opportunityId: action.opportunityId ?? null,
      type: action.type,
      capabilityKey: action.capabilityKey ?? null,
      area: action.area ?? '',
      title: action.title ?? '',
      label: action.label ?? '',
      summary: action.summary ?? '',
      link: action.link ?? '',
      payload: action.payload ?? {},
      status: 'proposed',
    });
    return shapedAction(doc.toObject());
  }

  async listByPartner(partnerId, { status = 'proposed', limit = 20 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const filter = { partnerId };
    if (status) filter.status = status;
    const rows = await OraActionModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(lim)
      .lean();
    return rows.map(shapedAction);
  }

  async findById(partnerId, id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return shapedAction(await OraActionModel.findOne({ _id: id, partnerId }).lean());
  }

  /** Atomic proposed -> executing transition. One approval can execute once. */
  async claimForExecution(partnerId, id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await OraActionModel.findOneAndUpdate(
      { _id: id, partnerId, status: 'proposed' },
      { $set: { status: 'executing', approvedAt: new Date() } },
      { new: true },
    ).lean();
    return shapedAction(doc);
  }

  async markExecuted(id, result) {
    const doc = await OraActionModel.findByIdAndUpdate(
      id,
      { $set: { status: 'executed', result: result ?? null, error: null, executedAt: new Date() } },
      { new: true },
    ).lean();
    return shapedAction(doc);
  }

  async markFailed(id, error) {
    const doc = await OraActionModel.findByIdAndUpdate(
      id,
      { $set: { status: 'failed', error: String(error ?? 'Action failed').slice(0, 500), executedAt: new Date() } },
      { new: true },
    ).lean();
    return shapedAction(doc);
  }

  async skip(partnerId, id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await OraActionModel.findOneAndUpdate(
      { _id: id, partnerId, status: 'proposed' },
      { $set: { status: 'skipped', executedAt: new Date() } },
      { new: true },
    ).lean();
    return shapedAction(doc);
  }

  async countProposed(partnerId) {
    return OraActionModel.countDocuments({ partnerId, status: 'proposed' });
  }
}

/** Append-only analytics events (one row per answered turn). */
export class MongoOraAnalyticsStore {
  async recordEvent(event) {
    await OraEventModel.create({
      partnerId: event.partnerId,
      conversationId: event.conversationId,
      topic: String(event.topic ?? 'general').slice(0, 20),
      messageChars: Number(event.messageChars) || 0,
      replyChars: Number(event.replyChars) || 0,
      latencyMs: Number(event.latencyMs) || 0,
      at: event.at ?? new Date(),
    });
    return { recorded: true };
  }

  async eventsFor(partnerId, since) {
    const docs = await OraEventModel.find({ partnerId, at: { $gte: since } })
      .select('conversationId topic at')
      .sort({ at: -1 })
      .limit(2000)
      .lean();
    return docs.map((d) => ({
      topic: d.topic,
      conversationId: d.conversationId ? oid(d.conversationId) : null,
      at: d.at,
    }));
  }
}
