import mongoose from 'mongoose';
import {
  TrainingCourseModel,
  TrainingLessonModel,
  TrainingProgressModel,
} from './Training.models.js';

const oid = (value) => String(value);
const objectId = (value) => (mongoose.isValidObjectId(value) ? value : null);

export const shapeCourse = (doc) => (doc ? {
  id: oid(doc._id),
  title: doc.title,
  tagline: doc.tagline ?? '',
  description: doc.description ?? '',
  milestone: doc.milestone ?? null,
  coverUrl: doc.coverUrl ?? null,
  status: doc.status,
  sortOrder: Number(doc.sortOrder) || 0,
  publishedAt: doc.publishedAt ?? null,
  archivedAt: doc.archivedAt ?? null,
  createdAt: doc.createdAt ?? null,
  updatedAt: doc.updatedAt ?? null,
} : null);

export const shapeLesson = (doc) => (doc ? {
  id: oid(doc._id),
  courseId: oid(doc.courseId),
  title: doc.title,
  summary: doc.summary ?? '',
  body: doc.body ?? '',
  takeaways: Array.isArray(doc.takeaways) ? doc.takeaways : [],
  transcript: doc.transcript ?? '',
  youtubeId: doc.youtubeId ?? null,
  youtubeUrl: doc.youtubeUrl ?? null,
  thumbnailUrl: doc.thumbnailUrl ?? null,
  durationSec: Number(doc.durationSec) || 0,
  quiz: Array.isArray(doc.quiz)
    ? doc.quiz.map((question) => ({
      q: question.q,
      options: Array.isArray(question.options) ? question.options : [],
      answer: Number(question.answer) || 0,
    }))
    : [],
  status: doc.status,
  sortOrder: Number(doc.sortOrder) || 0,
  createdAt: doc.createdAt ?? null,
  updatedAt: doc.updatedAt ?? null,
} : null);

const watchObject = (value) => {
  if (value instanceof Map) return Object.fromEntries(value);
  return value ?? {};
};

export const shapeProgress = (doc) => (doc ? {
  id: oid(doc._id),
  partnerId: oid(doc.partnerId),
  courseId: doc.courseId,
  completedLessons: Array.isArray(doc.completedLessons) ? doc.completedLessons : [],
  certificateAt: doc.certificateAt ?? null,
  watch: watchObject(doc.watch),
  createdAt: doc.createdAt ?? null,
  updatedAt: doc.updatedAt ?? null,
} : null);

/** Mongo implementation for dynamic courses, lessons, watch state and progress. */
export class MongoTrainingStore {
  // ---------------------------------------------------------------- courses
  async createCourse(data) {
    const doc = await TrainingCourseModel.create(data);
    return shapeCourse(doc.toObject());
  }

  async updateCourse(id, patch) {
    if (!objectId(id)) return null;
    const doc = await TrainingCourseModel.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    return shapeCourse(doc);
  }

  async deleteCourse(id) {
    if (!objectId(id)) return null;
    const doc = await TrainingCourseModel.findByIdAndDelete(id).lean();
    return shapeCourse(doc);
  }

  async findCourseById(id) {
    if (!objectId(id)) return null;
    return shapeCourse(await TrainingCourseModel.findById(id).lean());
  }

  async findPublishedCourseById(id) {
    if (!objectId(id)) return null;
    return shapeCourse(await TrainingCourseModel.findOne({ _id: id, status: 'published' }).lean());
  }

  async listCourses({ status = null } = {}) {
    const filter = {};
    if (status) filter.status = status;
    const rows = await TrainingCourseModel.find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    return rows.map(shapeCourse);
  }

  async listPublishedCourses() {
    const rows = await TrainingCourseModel.find({ status: 'published' })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    return rows.map(shapeCourse);
  }

  async findCoursesByIds(ids = []) {
    const safe = (ids ?? []).filter((id) => objectId(id));
    if (safe.length === 0) return [];
    const rows = await TrainingCourseModel.find({ _id: { $in: safe } }).lean();
    return rows.map(shapeCourse);
  }

  async publishedMilestoneConflict(milestone, excludeId = null) {
    if (!milestone) return null;
    const filter = { milestone, status: 'published' };
    if (excludeId && objectId(excludeId)) filter._id = { $ne: excludeId };
    return shapeCourse(await TrainingCourseModel.findOne(filter).sort({ sortOrder: 1 }).lean());
  }

  async findPublishedCourseByMilestone(milestone) {
    if (!milestone) return null;
    return shapeCourse(await TrainingCourseModel.findOne({ milestone, status: 'published' }).sort({ sortOrder: 1 }).lean());
  }

  async nextCourseOrder() {
    const row = await TrainingCourseModel.findOne({}).sort({ sortOrder: -1 }).select('sortOrder').lean();
    return (Number(row?.sortOrder) || 0) + 1;
  }

  async reorderCourses(ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const operations = ids.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { sortOrder: index } },
      },
    }));
    await TrainingCourseModel.bulkWrite(operations);
    return this.listCourses();
  }

  async searchPublishedCourses(query, limit = 5) {
    const needle = String(query ?? '').trim();
    if (!needle) return [];
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const rows = await TrainingCourseModel.find({
      status: 'published',
      $or: [{ title: re }, { tagline: re }, { description: re }],
    })
      .sort({ sortOrder: 1 })
      .limit(Math.min(Math.max(Number(limit) || 5, 1), 10))
      .lean();
    return rows.map(shapeCourse);
  }

  // ---------------------------------------------------------------- lessons
  async createLesson(courseId, data) {
    if (!objectId(courseId)) return null;
    const doc = await TrainingLessonModel.create({ ...data, courseId });
    return shapeLesson(doc.toObject());
  }

  async updateLesson(courseId, id, patch) {
    if (!objectId(courseId) || !objectId(id)) return null;
    const doc = await TrainingLessonModel.findOneAndUpdate(
      { _id: id, courseId },
      { $set: patch },
      { new: true },
    ).lean();
    return shapeLesson(doc);
  }

  async deleteLesson(courseId, id) {
    if (!objectId(courseId) || !objectId(id)) return null;
    const doc = await TrainingLessonModel.findOneAndDelete({ _id: id, courseId }).lean();
    if (doc) {
      await TrainingProgressModel.updateMany(
        { courseId: String(courseId), completedLessons: String(id) },
        { $pull: { completedLessons: String(id) }, $unset: { [`watch.${String(id)}`]: 1 } },
      );
    }
    return shapeLesson(doc);
  }

  async findLessonById(courseId, id) {
    if (!objectId(courseId) || !objectId(id)) return null;
    return shapeLesson(await TrainingLessonModel.findOne({ _id: id, courseId }).lean());
  }

  async findPublishedLesson(courseId, id) {
    if (!objectId(courseId) || !objectId(id)) return null;
    return shapeLesson(await TrainingLessonModel.findOne({ _id: id, courseId, status: 'published' }).lean());
  }

  async listLessons(courseId, { status = null } = {}) {
    if (!objectId(courseId)) return [];
    const filter = { courseId };
    if (status) filter.status = status;
    const rows = await TrainingLessonModel.find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    return rows.map(shapeLesson);
  }

  async listPublishedLessons(courseId) {
    return this.listLessons(courseId, { status: 'published' });
  }

  async listLessonsForCourses(courseIds = [], { status = null } = {}) {
    const safe = (courseIds ?? []).filter((id) => objectId(id));
    if (safe.length === 0) return [];
    const filter = { courseId: { $in: safe } };
    if (status) filter.status = status;
    const rows = await TrainingLessonModel.find(filter)
      .sort({ courseId: 1, sortOrder: 1, createdAt: 1 })
      .lean();
    return rows.map(shapeLesson);
  }

  async nextLessonOrder(courseId) {
    if (!objectId(courseId)) return 0;
    const row = await TrainingLessonModel.findOne({ courseId }).sort({ sortOrder: -1 }).select('sortOrder').lean();
    return (Number(row?.sortOrder) || 0) + 1;
  }

  async reorderLessons(courseId, ids = []) {
    if (!objectId(courseId) || !Array.isArray(ids) || ids.length === 0) return [];
    const operations = ids.map((id, index) => ({
      updateOne: {
        filter: { _id: id, courseId },
        update: { $set: { sortOrder: index } },
      },
    }));
    await TrainingLessonModel.bulkWrite(operations);
    return this.listLessons(courseId);
  }

  // --------------------------------------------------------------- progress
  async findByPartner(partnerId, courseId) {
    return shapeProgress(await TrainingProgressModel.findOne({ partnerId, courseId: String(courseId) }).lean());
  }

  async listByPartner(partnerId) {
    const rows = await TrainingProgressModel.find({ partnerId }).lean();
    return rows.map(shapeProgress);
  }

  /** Idempotent lesson completion; stamps the certificate once. */
  async completeLesson(partnerId, courseId, lessonId, certified) {
    const existing = await TrainingProgressModel.findOne({ partnerId, courseId: String(courseId) }).lean();
    const update = { $addToSet: { completedLessons: String(lessonId) } };
    if (certified && !existing?.certificateAt) update.$set = { certificateAt: new Date() };
    const row = await TrainingProgressModel.findOneAndUpdate(
      { partnerId, courseId: String(courseId) },
      update,
      { new: true, upsert: true },
    ).lean();
    return shapeProgress(row);
  }

  /** Monotonic watch heartbeat — percent/seconds only move forward. */
  async recordWatch(partnerId, courseId, lessonId, percent, seconds) {
    const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
    const sec = Math.max(0, Math.round(Number(seconds) || 0));
    const row = await TrainingProgressModel.findOneAndUpdate(
      { partnerId, courseId: String(courseId) },
      {
        $max: {
          [`watch.${lessonId}.percent`]: pct,
          [`watch.${lessonId}.seconds`]: sec,
        },
        $set: { [`watch.${lessonId}.updatedAt`]: new Date() },
      },
      { new: true, upsert: true },
    ).lean();
    const watch = watchObject(row?.watch);
    const w = watch?.[lessonId];
    return { lessonId, percent: w?.percent ?? pct, seconds: w?.seconds ?? sec, updatedAt: w?.updatedAt ?? null };
  }

  async getWatch(partnerId, courseId) {
    const row = await TrainingProgressModel.findOne({ partnerId, courseId: String(courseId) }).lean();
    const watch = watchObject(row?.watch);
    return Object.fromEntries(
      Object.entries(watch).map(([lessonId, w]) => [
        lessonId,
        {
          lessonId,
          percent: Number(w?.percent) || 0,
          seconds: Number(w?.seconds) || 0,
          updatedAt: w?.updatedAt ?? null,
        },
      ]),
    );
  }

  /** Bounded bulk fetch for team compliance rollups. */
  async listForPartners(partnerIds, courseIds = null) {
    if (!partnerIds?.length) return [];
    const query = { partnerId: { $in: partnerIds } };
    if (courseIds?.length) query.courseId = { $in: courseIds.map(String) };
    const rows = await TrainingProgressModel.find(query).lean();
    return rows.map(shapeProgress);
  }

  async countLessonCompletions(courseId, lessonId) {
    return TrainingProgressModel.countDocuments({
      courseId: String(courseId),
      completedLessons: String(lessonId),
    });
  }
}
