import mongoose from 'mongoose';

const mentorCheckinSchema = new mongoose.Schema(
  {
    mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    kind: {
      type: String,
      enum: ['welcome', 'day3', 'day7', 'ad_hoc'],
      default: 'ad_hoc',
      index: true,
    },
    note: { type: String, default: '', trim: true, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'mentor_checkins' },
);

mentorCheckinSchema.index({ mentorId: 1, memberId: 1, createdAt: -1 });
mentorCheckinSchema.index({ createdAt: -1 });

export const MentorCheckinModel =
  mongoose.models.MentorCheckin ?? mongoose.model('MentorCheckin', mentorCheckinSchema);

const oid = (value) => String(value);

export class MentorCheckinRepository {
  async create({ mentorId, memberId, kind = 'ad_hoc', note = '' }) {
    const doc = await MentorCheckinModel.create({
      mentorId,
      memberId,
      kind,
      note: String(note ?? '').trim().slice(0, 500),
    });
    return {
      id: oid(doc._id),
      mentorId: oid(doc.mentorId),
      memberId: oid(doc.memberId),
      kind: doc.kind,
      note: doc.note,
      createdAt: doc.createdAt,
    };
  }

  async listForMentor(mentorId, memberIds = []) {
    const ids = (Array.isArray(memberIds) ? memberIds : [])
      .map(String)
      .filter((id) => /^[a-fA-F0-9]{24}$/.test(id))
      .slice(0, 2000);
    if (ids.length === 0) return [];
    const rows = await MentorCheckinModel.find({ mentorId, memberId: { $in: ids } })
      .sort({ createdAt: 1 })
      .limit(5000)
      .lean();
    return rows.map((row) => ({
      id: oid(row._id),
      memberId: oid(row.memberId),
      kind: row.kind,
      note: row.note,
      createdAt: row.createdAt,
    }));
  }

  async statsSince(since) {
    const rows = await MentorCheckinModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: null, count: { $sum: 1 }, mentors: { $addToSet: '$mentorId' } } },
      { $project: { _id: 0, count: 1, mentors: { $size: '$mentors' } } },
    ]);
    return { count: Number(rows[0]?.count ?? 0), mentors: Number(rows[0]?.mentors ?? 0) };
  }
}
