import mongoose from 'mongoose';

const progressSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    courseId: { type: String, required: true, index: true },
    completedLessons: { type: [String], default: [] },
    certificateAt: { type: Date, default: null },
    // Server-side video watch attestation: lessonId -> { percent 0-100, seconds, updatedAt }.
    // Monotonic ($max on percent/seconds) so heartbeats can't rewind progress.
    watch: {
      type: Map,
      of: new mongoose.Schema(
        {
          percent: { type: Number, default: 0 },
          seconds: { type: Number, default: 0 },
          updatedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: {},
    },
  },
  { timestamps: true },
);
progressSchema.index({ partnerId: 1, courseId: 1 }, { unique: true });

export const TrainingProgressModel =
  mongoose.models['Training-progress'] ?? mongoose.model('Training-progress', progressSchema);

export { TrainingQuizModel } from './TrainingQuiz.mongo.model.js';

const oid = (v) => String(v);
const shaped = (o) => (o ? { ...o, id: oid(o._id), partnerId: oid(o.partnerId) } : null);

/** Mongo implementation of the training store. Reads use `.lean()`. */
export class MongoTrainingStore {
  async findByPartner(partnerId, courseId) {
    return shaped(await TrainingProgressModel.findOne({ partnerId, courseId }).lean());
  }

  async listByPartner(partnerId) {
    const rows = await TrainingProgressModel.find({ partnerId }).lean();
    return rows.map(shaped);
  }

  /** Idempotent lesson completion; stamps the certificate on the last one. */
  async completeLesson(partnerId, courseId, lessonId, certified) {
    const update = { $addToSet: { completedLessons: lessonId } };
    if (certified) update.$set = { certificateAt: new Date() };
    const row = await TrainingProgressModel.findOneAndUpdate(
      { partnerId, courseId },
      update,
      { new: true, upsert: true },
    ).lean();
    return shaped(row);
  }

  /** Monotonic watch heartbeat — percent/seconds only move forward. */
  async recordWatch(partnerId, courseId, lessonId, percent, seconds) {
    const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
    const sec = Math.max(0, Math.round(Number(seconds) || 0));
    const row = await TrainingProgressModel.findOneAndUpdate(
      { partnerId, courseId },
      {
        $max: {
          [`watch.${lessonId}.percent`]: pct,
          [`watch.${lessonId}.seconds`]: sec,
        },
        $set: { [`watch.${lessonId}.updatedAt`]: new Date() },
      },
      { new: true, upsert: true },
    ).lean();
    const w = row?.watch instanceof Map ? row.watch.get(lessonId) : row?.watch?.[lessonId];
    return { lessonId, percent: w?.percent ?? pct, seconds: w?.seconds ?? sec, updatedAt: w?.updatedAt ?? null };
  }

  async getWatch(partnerId, courseId) {
    const row = await TrainingProgressModel.findOne({ partnerId, courseId }).lean();
    const watch = row?.watch instanceof Map ? Object.fromEntries(row.watch) : (row?.watch ?? {});
    return Object.fromEntries(
      Object.entries(watch).map(([lessonId, w]) => [
        lessonId,
        { lessonId, percent: w?.percent ?? 0, seconds: w?.seconds ?? 0, updatedAt: w?.updatedAt ?? null },
      ]),
    );
  }

  /** Bounded bulk fetch for team compliance rollups. */
  async listForPartners(partnerIds, courseIds = null) {
    if (!partnerIds?.length) return [];
    const q = { partnerId: { $in: partnerIds } };
    if (courseIds?.length) q.courseId = { $in: courseIds };
    const rows = await TrainingProgressModel.find(q).lean();
    return rows.map(shaped);
  }
  // Quiz overrides (admin-owned) — one doc per lesson, merged over the code catalog.
  async getQuiz(courseId, lessonId) {
    const { TrainingQuizModel } = await import('./TrainingQuiz.mongo.model.js');
    const doc = await TrainingQuizModel.findOne({ courseId, lessonId }).lean();
    return doc?.quiz ?? null;
  }

  async listQuizzes() {
    const { TrainingQuizModel } = await import('./TrainingQuiz.mongo.model.js');
    const docs = await TrainingQuizModel.find({}).lean();
    return docs.map((d) => ({ courseId: d.courseId, lessonId: d.lessonId, quiz: d.quiz }));
  }

  async upsertQuiz(courseId, lessonId, quiz) {
    const { TrainingQuizModel } = await import('./TrainingQuiz.mongo.model.js');
    const doc = await TrainingQuizModel.findOneAndUpdate(
      { courseId, lessonId },
      { $set: { quiz } },
      { new: true, upsert: true },
    ).lean();
    return { courseId: doc.courseId, lessonId: doc.lessonId, quiz: doc.quiz };
  }

  // Media overrides (admin-owned) — one doc per lesson; set fields win
  // over the code catalog, null/empty fields fall back to it.
  async getMedia(courseId, lessonId) {
    const { TrainingMediaModel } = await import('./TrainingMedia.mongo.model.js');
    const doc = await TrainingMediaModel.findOne({ courseId, lessonId }).lean();
    return doc ? shapedMedia(doc) : null;
  }

  async listMedia() {
    const { TrainingMediaModel } = await import('./TrainingMedia.mongo.model.js');
    const docs = await TrainingMediaModel.find({}).lean();
    return docs.map(shapedMedia);
  }

  async upsertMedia(courseId, lessonId, media, updatedBy = null) {
    const { TrainingMediaModel } = await import('./TrainingMedia.mongo.model.js');
    const clean = (v) => {
      const s = v === undefined || v === null ? null : String(v).trim();
      return s === '' ? null : s;
    };
    const takeaways = Array.isArray(media.takeaways)
      ? media.takeaways.map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 10).map((t) => t.slice(0, 200))
      : undefined;
    const doc = await TrainingMediaModel.findOneAndUpdate(
      { courseId, lessonId },
      {
        $set: {
          videoUrl: clean(media.videoUrl),
          posterUrl: clean(media.posterUrl),
          captionsUrl: clean(media.captionsUrl),
          transcript: clean(media.transcript),
          durationSec: media.durationSec === undefined || media.durationSec === null || media.durationSec === ''
            ? null
            : Math.max(0, Math.min(86400, Math.round(Number(media.durationSec) || 0))),
          body: clean(media.body),
          ...(takeaways !== undefined ? { takeaways } : {}),
          updatedBy: updatedBy ? String(updatedBy) : null,
        },
      },
      { new: true, upsert: true },
    ).lean();
    return shapedMedia(doc);
  }

  async deleteMedia(courseId, lessonId) {
    const { TrainingMediaModel } = await import('./TrainingMedia.mongo.model.js');
    const res = await TrainingMediaModel.deleteOne({ courseId, lessonId });
    return { reverted: (res.deletedCount ?? 0) > 0 };
  }
}

const shapedMedia = (d) => ({
  courseId: d.courseId,
  lessonId: d.lessonId,
  videoUrl: d.videoUrl ?? null,
  posterUrl: d.posterUrl ?? null,
  captionsUrl: d.captionsUrl ?? null,
  transcript: d.transcript ?? null,
  durationSec: d.durationSec ?? null,
  body: d.body ?? null,
  takeaways: Array.isArray(d.takeaways) ? d.takeaways : [],
});
