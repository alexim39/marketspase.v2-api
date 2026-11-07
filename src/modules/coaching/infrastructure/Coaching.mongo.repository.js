import { CoachingNoteModel } from '../infrastructure/Coaching.model.js';

const oid = (v) => String(v);
const shapedNote = (d) => ({
  id: oid(d._id),
  memberId: oid(d.memberId),
  coachId: oid(d.coachId),
  authorId: oid(d.authorId ?? d.coachId),
  body: d.body,
  createdAt: d.createdAt,
});

export class MongoCoachingStore {
  async addNote({ memberId, coachId, authorId = null, body }) {
    const doc = await CoachingNoteModel.create({ memberId, coachId, authorId, body });
    return shapedNote(doc);
  }

  async listNotes(memberId, limit = 50) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const docs = await CoachingNoteModel.find({ memberId }).sort({ createdAt: -1 }).limit(lim).lean();
    return docs.map(shapedNote);
  }

  /** Recent notes across a bounded set of downline member ids (coach inbox). */
  async listNotesForMembers(memberIds, limit = 50) {
    if (!Array.isArray(memberIds) || memberIds.length === 0) return [];
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const docs = await CoachingNoteModel.find({ memberId: { $in: memberIds } })
      .sort({ createdAt: -1 })
      .limit(lim)
      .lean();
    return docs.map(shapedNote);
  }
}
