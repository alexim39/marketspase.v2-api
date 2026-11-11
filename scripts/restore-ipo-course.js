import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

/**
 * Restore the exact IPO course snapshot.
 *
 * Dry-run by default. Set APPLY=1 to write into the configured database.
 * Uses the raw MongoDB driver so original ids, timestamps and __v survive,
 * exactly as exported. The snapshot is version-controlled in
 * `api/seed/ipo-course.snapshot.json`.
 */

const APPLY = process.env.APPLY === '1';
const SNAPSHOT_PATH = path.join(process.cwd(), 'seed', 'ipo-course.snapshot.json');

const oid = (value) => (value ? new mongoose.Types.ObjectId(String(value)) : null);
const date = (value) => (value ? new Date(value) : null);

const hydrateCourse = (course) => ({
  ...course,
  _id: oid(course._id),
  createdBy: oid(course.createdBy),
  updatedBy: oid(course.updatedBy),
  publishedAt: date(course.publishedAt),
  archivedAt: date(course.archivedAt),
  createdAt: date(course.createdAt),
  updatedAt: date(course.updatedAt),
});

const hydrateLesson = (lesson) => ({
  ...lesson,
  _id: oid(lesson._id),
  courseId: oid(lesson.courseId),
  createdBy: oid(lesson.createdBy),
  updatedBy: oid(lesson.updatedBy),
  createdAt: date(lesson.createdAt),
  updatedAt: date(lesson.updatedAt),
  quiz: Array.isArray(lesson.quiz)
    ? lesson.quiz.map((question) => ({
      q: question.q,
      options: [...question.options],
      answer: Number(question.answer),
    }))
    : [],
});

const snapshot = JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf8'));
if (snapshot?.schemaVersion !== 1 || snapshot?.kind !== 'marketspase-training-course') {
  throw new Error('Unsupported IPO snapshot format');
}
if (!snapshot.course?._id || !Array.isArray(snapshot.lessons) || snapshot.lessons.length === 0) {
  throw new Error('IPO snapshot is incomplete');
}
for (const lesson of snapshot.lessons) {
  if (!lesson._id || String(lesson.courseId) !== String(snapshot.course._id)) {
    throw new Error(`Lesson ${lesson.title ?? lesson._id} does not belong to the snapshot course`);
  }
}

const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

await mongoose.connect(uri);
const db = mongoose.connection.db;
const courseDoc = hydrateCourse(snapshot.course);
const lessonDocs = snapshot.lessons.map(hydrateLesson);

const summary = {
  database: mongoose.connection.name,
  mode: APPLY ? 'apply' : 'dry-run (set APPLY=1 to restore)',
  snapshotExportedAt: snapshot.exportedAt,
  courseId: String(courseDoc._id),
  courseTitle: courseDoc.title,
  courseStatus: courseDoc.status,
  lessonCount: lessonDocs.length,
  quizQuestions: lessonDocs.reduce((total, lesson) => total + lesson.quiz.length, 0),
  videos: lessonDocs.map((lesson) => ({ title: lesson.title, youtubeId: lesson.youtubeId, durationSec: lesson.durationSec })),
};

if (APPLY) {
  // Raw replace preserves the exact course/lesson ids and timestamps. Running
  // again is idempotent: each record is keyed by its original _id.
  await db.collection('training_courses').replaceOne(
    { _id: courseDoc._id },
    courseDoc,
    { upsert: true },
  );
  for (const lesson of lessonDocs) {
    await db.collection('training_lessons').replaceOne(
      { _id: lesson._id },
      lesson,
      { upsert: true },
    );
  }
  summary.restoredCourse = await db.collection('training_courses').countDocuments({ _id: courseDoc._id });
  summary.restoredLessons = await db.collection('training_lessons').countDocuments({
    _id: { $in: lessonDocs.map((lesson) => lesson._id) },
  });
}

console.log(JSON.stringify(summary, null, 2));
await mongoose.connection.close(false);
