import { CoachingNoteModel } from '../infrastructure/Coaching.model.js';

const oid = (v) => String(v);

export class MongoCoachingStore {
  async addNote({ memberId, coachId, body }) {
    const doc = await CoachingNoteModel.create({ memberId, coachId, body });
    return { id: oid(doc._id), memberId: oid(doc.memberId), coachId: oid(doc.coachId), body: doc.body, createdAt: doc.createdAt };
  }

  async listNotes(memberId, limit = 50) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const docs = await CoachingNoteModel.find({ memberId }).sort({ createdAt: -1 }).limit(lim).lean();
    return docs.map((d) => ({ id: oid(d._id), memberId: oid(d.memberId), coachId: oid(d.coachId), body: d.body, createdAt: d.createdAt }));
  }
}
