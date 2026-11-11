import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

/**
 * Restore the exact QSG, SMO and Leadership course snapshots.
 * Dry-run by default. Set APPLY=1 to write. Raw driver keeps original ids,
 * timestamps and embedded quiz answer keys exactly as exported.
 */

const APPLY = process.env.APPLY === '1';
const SNAPSHOT_PATH = path.join(process.cwd(), 'seed', 'remaining-courses.snapshot.json');

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
if (snapshot?.schemaVersion !== 1 || snapshot?.kind !== 'marketspase-training-courses') {
  throw new Error('Unsupported remaining-courses snapshot format');
}
if (!Array.isArray(snapshot.courses) || snapshot.courses.length !== 3 || !Array.isArray(snapshot.lessons)) {
  throw new Error('Remaining-courses snapshot is incomplete');
}
const courseIds = new Set(snapshot.courses.map((course) => String(course._id)));
for (const lesson of snapshot.lessons) {
  if (!lesson._id || !courseIds.has(String(lesson.courseId))) {
    throw new Error(`Lesson ${lesson.title ?? lesson._id} does not belong to a snapshot course`);
  }
}

const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

await mongoose.connect(uri);
const db = mongoose.connection.db;
const courseDocs = snapshot.courses.map(hydrateCourse);
const lessonDocs = snapshot.lessons.map(hydrateLesson);

const summary = {
  database: mongoose.connection.name,
  mode: APPLY ? 'apply' : 'dry-run (set APPLY=1 to restore)',
  snapshotExportedAt: snapshot.exportedAt,
  courses: courseDocs.map((course) => ({
    id: String(course._id),
    title: course.title,
    milestone: course.milestone,
    status: course.status,
    lessons: lessonDocs.filter((lesson) => String(lesson.courseId) === String(course._id)).length,
  })),
  lessonCount: lessonDocs.length,
  quizQuestions: lessonDocs.reduce((total, lesson) => total + lesson.quiz.length, 0),
};

if (APPLY) {
  for (const course of courseDocs) {
    await db.collection('training_courses').replaceOne({ _id: course._id }, course, { upsert: true });
  }
  for (const lesson of lessonDocs) {
    await db.collection('training_lessons').replaceOne({ _id: lesson._id }, lesson, { upsert: true });
  }
  summary.restoredCourses = await db.collection('training_courses').countDocuments({
    _id: { $in: courseDocs.map((course) => course._id) },
  });
  summary.restoredLessons = await db.collection('training_lessons').countDocuments({
    _id: { $in: lessonDocs.map((lesson) => lesson._id) },
  });
}

console.log(JSON.stringify(summary, null, 2));
await mongoose.connection.close(false);
