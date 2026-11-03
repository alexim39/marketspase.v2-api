import mongoose from 'mongoose';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';

const eventSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, default: null },
    location: { type: String, default: '', maxlength: 200 },
    scope: { type: String, enum: ['global', 'team', 'leadership', 'members'], required: true, index: true },
    // Purpose-team channel only (other scopes stay null).
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null, index: true },
    // Featured slot — one highlighted event atop the page. Auto-drops at
    // `featuredUntil` (defaults to the event start).
    featured: { type: Boolean, default: false, index: true },
    featuredUntil: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
eventSchema.index({ scope: 1, startsAt: 1 });

const rsvpSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    status: { type: String, enum: ['going', 'interested', 'declined'], required: true },
    // Reminder idempotency (event-reminder sweep mirrors session-reminders):
    // atomic null-check stamps so parallel dynos never double-send.
    reminded24hAt: { type: Date, default: null },
    reminded1hAt: { type: Date, default: null },
    // Post-event turnout, marked by the organizer (null = unmarked).
    attended: { type: Boolean, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);
rsvpSchema.index({ eventId: 1, partnerId: 1 }, { unique: true });

export const EventModel = mongoose.models.Event ?? mongoose.model('Event', eventSchema);
export const EventRsvpModel = mongoose.models.EventRsvp ?? mongoose.model('EventRsvp', rsvpSchema);

const eventCommentSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    body: { type: String, required: true, maxlength: 1000 },
    // Threaded reply — null for top-level comments.
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventComment', default: null, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
eventCommentSchema.index({ eventId: 1, createdAt: 1 });

export const EventCommentModel = mongoose.models.EventComment ?? mongoose.model('EventComment', eventCommentSchema);

const oid = (v) => String(v);
// Aggregate $match does not cast strings to ObjectId (see community
// counts fix) — coerce explicitly for every $in over an ObjectId field.
const toObjectId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));
const oidList = (ids) => (ids ?? []).map(toObjectId);
const shaped = (o) => {
  if (!o) return null;
  const out = { ...o, id: oid(o._id) };
  if (out.authorId !== undefined) out.authorId = oid(out.authorId);
  if (out.eventId !== undefined) out.eventId = oid(out.eventId);
  if (out.partnerId !== undefined) out.partnerId = oid(out.partnerId);
  return out;
};

const emptyCounts = () => ({ going: 0, interested: 0, declined: 0, total: 0 });

/** Mongo implementation of the event store. Reads use `.lean()`. */
export class MongoEventStore {
  async createEvent(data) {
    return shaped((await EventModel.create(data)).toObject());
  }

  async findEventById(id) {
    return shaped(await EventModel.findById(id).lean());
  }

  /** Future-first candidates (visibility filtered in the use case). */
  async upcomingCandidates(now, limit = 60) {
    const docs = await EventModel.find({ startsAt: { $gte: now } })
      .sort({ featured: -1, startsAt: 1 })
      .limit(Math.min(Math.max(Number(limit) || 60, 1), 200))
      .lean();
    return docs.map(shaped);
  }

  async listByAuthor(authorId, limit = 50) {
    const docs = await EventModel.find({ authorId })
      .sort({ startsAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
      .lean();
    return docs.map(shaped);
  }

  async deleteEvent(id) {
    const [res] = await Promise.all([
      EventModel.deleteOne({ _id: id }),
      EventRsvpModel.deleteMany({ eventId: id }),
    ]);
    return { deleted: res.deletedCount > 0 };
  }

  async updateEvent(id, patch) {
    const doc = await EventModel.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean();
    return shaped(doc);
  }

  async setFeatured(id, featured, featuredUntil = null) {
    const doc = await EventModel.findByIdAndUpdate(
      id,
      { $set: { featured, featuredUntil: featured ? featuredUntil : null } },
      { new: true },
    ).lean();
    return shaped(doc);
  }

  /** Active featured upcoming events in a scope — the 1-slot cap counts these. */
  async countFeatured(scope, excludeId = null, now = new Date()) {
    const filter = {
      scope,
      featured: true,
      startsAt: { $gte: now },
      $or: [{ featuredUntil: null }, { featuredUntil: { $gt: now } }],
    };
    if (excludeId) filter._id = { $ne: excludeId };
    return EventModel.countDocuments(filter);
  }

  async upsertRsvp(eventId, partnerId, status) {
    const doc = await EventRsvpModel.findOneAndUpdate(
      { eventId, partnerId },
      { $set: { status } },
      { new: true, upsert: true },
    ).lean();
    return shaped(doc);
  }

  /**
   * Organizer attendee list — going/interested rows joined to partner
   * contact fields (powers reminders, the checklist and no-show nudges).
   * Caller gates author-or-admin; the store just reads.
   */
  async attendees(eventId, limit = 200) {
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const rows = await EventRsvpModel.find({
      eventId, status: { $in: ['going', 'interested'] },
    }).sort({ createdAt: 1 }).limit(lim).lean();
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((r) => String(r.partnerId)))];
    const partners = await PartnersModel.find({ _id: { $in: ids } })
      .select('name surname username phone email').lean().catch(() => []);
    const byId = Object.fromEntries((partners ?? []).map((p) => [String(p._id), p]));
    return rows.map((r) => {
      const p = byId[String(r.partnerId)] ?? null;
      return {
        partnerId: oid(r.partnerId),
        status: r.status,
        attended: r.attended ?? null,
        reminded24hAt: r.reminded24hAt ?? null,
        reminded1hAt: r.reminded1hAt ?? null,
        name: p ? [p.name, p.surname].filter(Boolean).join(' ') || p.username : 'Former member',
        username: p?.username ?? null,
        phone: p?.phone ?? null,
        email: p?.email ?? null,
      };
    });
  }

  /** Organizer marks turnout on an existing RSVP (walk-ins RSVP first). */
  async markAttendance(eventId, partnerId, attended) {
    const doc = await EventRsvpModel.findOneAndUpdate(
      { eventId, partnerId, status: { $in: ['going', 'interested'] } },
      { $set: { attended: attended === true } },
      { new: true },
    ).lean();
    return doc ? shaped(doc) : null;
  }

  async rsvpCounts(eventIds) {
    const out = Object.fromEntries(eventIds.map((id) => [String(id), emptyCounts()]));
    if (eventIds.length === 0) return out;
    const rows = await EventRsvpModel.aggregate([
      { $match: { eventId: { $in: oidList(eventIds) } } },
      { $group: { _id: { event: '$eventId', status: '$status' }, count: { $sum: 1 } } },
    ]);
    for (const r of rows) {
      const key = oid(r._id.event);
      if (out[key] && r._id.status in out[key]) {
        out[key][r._id.status] = r.count;
        out[key].total += r.count;
      }
    }
    return out;
  }

  async myRsvps(eventIds, partnerId) {
    if (eventIds.length === 0) return {};
    const rows = await EventRsvpModel.find({ eventId: { $in: eventIds }, partnerId })
      .select('eventId status')
      .lean();
    return Object.fromEntries(rows.map((r) => [oid(r.eventId), r.status]));
  }

  /**
   * Upcoming events this partner RSVP'd going/interested to — the
   * Action Center reminder source. Cancelled events vanish naturally
   * (their row is gone); declined RSVPs never remind.
   */
  async upcomingRsvps(partnerId, now, horizonDays = 7, limit = 10) {
    const horizon = new Date(new Date(now).getTime() + horizonDays * 86400000);
    const rsvps = await EventRsvpModel.find({
      partnerId,
      status: { $in: ['going', 'interested'] },
    }).select('eventId status').lean();
    if (rsvps.length === 0) return [];
    const mine = Object.fromEntries(rsvps.map((r) => [oid(r.eventId), r.status]));
    const docs = await EventModel.find({
      _id: { $in: oidList(Object.keys(mine)) },
      startsAt: { $gte: new Date(now), $lte: horizon },
    }).sort({ startsAt: 1 }).limit(Math.min(Math.max(Number(limit) || 10, 1), 25)).lean();
    return docs.map((d) => ({ ...shaped(d), myRsvp: mine[oid(d._id)] }));
  }

  /** RSVPs (going/interested) since `since` — leadership footprint. */
  async countRsvpsSince(partnerId, since) {
    return EventRsvpModel.countDocuments({
      partnerId,
      status: { $in: ['going', 'interested'] },
      createdAt: { $gte: since },
    });
  }

  async authorLabels(ids) {
    const uniq = [...new Set(ids.map(String))].filter(Boolean);
    if (uniq.length === 0) return {};
    const docs = await PartnersModel.find({ _id: { $in: uniq } }).select('username name surname profileImage').lean();
    return Object.fromEntries(docs.map((d) => [oid(d._id), {
      username: d.username,
      name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
      profileImage: d.profileImage ?? null,
    }]));
  }

  /** Discussion thread for one event — oldest first, capped. */
  async listComments(eventId, limit = 100) {
    const docs = await EventCommentModel.find({ eventId })
      .sort({ createdAt: 1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 200))
      .lean();
    return docs.map(shaped);
  }

  async addComment({ eventId, authorId, body, parentId = null }) {
    const doc = await EventCommentModel.create({ eventId, authorId, body, parentId: parentId ?? null });
    return shaped(doc.toObject());
  }

  async findComment(eventId, commentId) {
    return shaped(await EventCommentModel.findOne({ _id: commentId, eventId }).lean());
  }

  async deleteComment(eventId, commentId) {
    const [comment, replies] = await Promise.all([
      EventCommentModel.findOne({ _id: commentId, eventId }).lean(),
      EventCommentModel.deleteMany({ parentId: commentId, eventId }),
    ]);
    if (!comment) return { deleted: false };
    await EventCommentModel.deleteOne({ _id: commentId, eventId });
    return { deleted: true, replies: replies.deletedCount ?? 0 };
  }

  async commentCounts(eventIds) {
    const out = Object.fromEntries(eventIds.map((id) => [String(id), 0]));
    if (eventIds.length === 0) return out;
    const rows = await EventCommentModel.aggregate([
      { $match: { eventId: { $in: oidList(eventIds) } } },
      { $group: { _id: '$eventId', count: { $sum: 1 } } },
    ]);
    for (const r of rows) out[oid(r._id)] = r.count;
    return out;
  }
}
