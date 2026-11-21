import 'dotenv/config';
import mongoose from 'mongoose';
import { TrainingCourseModel, TrainingLessonModel } from '../src/modules/training/infrastructure/Training.models.js';
import { MongoAuditStore } from '../src/modules/audit/infrastructure/Audit.store.js';

/**
 * Merge the one-lesson "Recruiting Machine" elective into
 * "Recruiting Mastery 2026".
 *
 * The lesson itself is copied by seed-recruiting-course.js. This script:
 * - verifies the source course still has exactly one lesson;
 * - archives the old course (it stays in the database and certificate history);
 * - copies completed progress for that video into the new course, so existing
 *   learners do not have to rewatch it;
 * - never certifies the new course early.
 *
 * Idempotent: re-running keeps the old course archived and unions the same
 * completed lesson into the new progress row.
 */

const OLD_TITLE = 'Recruiting Machine';
const NEW_TITLE = 'Recruiting Mastery 2026';
const VIDEO_ID = 'm1jU_e8ogok';

const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

await mongoose.connect(uri);
const db = mongoose.connection.db;
const admin = await db.collection('partners').findOne({ role: 'admin' });
if (!admin) throw new Error('No admin account found');

const now = new Date();
const audit = new MongoAuditStore();

const oldCourse = await TrainingCourseModel.findOne({ title: OLD_TITLE }).lean();
const newCourse = await TrainingCourseModel.findOne({ title: NEW_TITLE }).lean();
if (!oldCourse) throw new Error(`Course not found: ${OLD_TITLE}`);
if (!newCourse) throw new Error(`Course not found: ${NEW_TITLE} - run seed:recruiting first`);

const oldLessons = await TrainingLessonModel.find({ courseId: oldCourse._id }).lean();
if (oldLessons.length !== 1) {
  throw new Error(`${OLD_TITLE} has ${oldLessons.length} lessons; expected exactly 1 before archiving`);
}
const oldLesson = oldLessons[0];
if (oldLesson.youtubeId !== VIDEO_ID) {
  throw new Error(`${OLD_TITLE} lesson is not the expected video (${VIDEO_ID})`);
}

const newLesson = await TrainingLessonModel.findOne({
  courseId: newCourse._id,
  youtubeId: VIDEO_ID,
}).lean();
if (!newLesson) {
  throw new Error(`The ${VIDEO_ID} lesson is missing from ${NEW_TITLE} - run seed:recruiting first`);
}

if (oldCourse.status !== 'archived') {
  await TrainingCourseModel.updateOne(
    { _id: oldCourse._id },
    {
      $set: {
        status: 'archived',
        archivedAt: now,
        updatedBy: admin._id,
      },
    },
  );
  await audit.record({
    actorId: String(admin._id),
    action: 'training.course.archive',
    targetType: 'course',
    targetId: String(oldCourse._id),
    detail: {
      title: OLD_TITLE,
      mergedInto: String(newCourse._id),
      source: 'merge:recruiting-machine',
    },
  });
}

const progress = db.collection('training_progress');
const oldRows = await progress.find({
  courseId: String(oldCourse._id),
  completedLessons: String(oldLesson._id),
}).toArray();

let migrated = 0;
let alreadyDone = 0;
for (const row of oldRows) {
  const partnerId = String(row.partnerId);
  const existing = await progress.findOne({
    partnerId: row.partnerId,
    courseId: String(newCourse._id),
  });
  const completed = new Set((existing?.completedLessons ?? []).map(String));
  if (completed.has(String(newLesson._id))) {
    alreadyDone += 1;
    continue;
  }
  completed.add(String(newLesson._id));
  const watch = { ...(existing?.watch ?? {}) };
  watch[String(newLesson._id)] = {
    percent: 100,
    seconds: Number(newLesson.durationSec) || 0,
    updatedAt: now,
  };
  await progress.updateOne(
    { partnerId: row.partnerId, courseId: String(newCourse._id) },
    {
      $set: {
        completedLessons: [...completed],
        watch,
        updatedAt: now,
      },
      $setOnInsert: {
        partnerId: row.partnerId,
        courseId: String(newCourse._id),
        certificateAt: null,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  migrated += 1;
}

if (migrated + alreadyDone > 0) {
  await audit.record({
    actorId: String(admin._id),
    action: 'training.course.update',
    targetType: 'course',
    targetId: String(newCourse._id),
    detail: {
      migration: 'recruiting-machine-progress',
      fromCourseId: String(oldCourse._id),
      lessonId: String(newLesson._id),
      videoId: VIDEO_ID,
      partners: migrated + alreadyDone,
      newlyMigrated: migrated,
      source: 'merge:recruiting-machine',
    },
  });
}

const freshOld = await TrainingCourseModel.findById(oldCourse._id).lean();
const freshNew = await TrainingLessonModel.find({ courseId: newCourse._id }).sort({ sortOrder: 1 }).lean();
console.log(JSON.stringify({
  database: db.databaseName,
  oldCourse: {
    id: String(oldCourse._id),
    title: oldCourse.title,
    status: freshOld.status,
    archivedAt: freshOld.archivedAt ?? null,
    lessonCount: oldLessons.length,
    certificateRowsKept: await progress.countDocuments({
      courseId: String(oldCourse._id),
      certificateAt: { $ne: null },
    }),
  },
  newCourse: {
    id: String(newCourse._id),
    title: newCourse.title,
    status: newCourse.status,
    lessonCount: freshNew.length,
    lessons: freshNew.map((lesson) => lesson.title),
  },
  progress: { migrated, alreadyDone, sourceRows: oldRows.length },
}, null, 2));

await mongoose.connection.close(false);
