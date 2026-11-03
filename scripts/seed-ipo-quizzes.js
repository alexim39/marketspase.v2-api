/**
 * Seed IPO quizzes into Mongo so Admin → Training quizzes shows them.
 *
 * Source of truth is the code catalog (Training.catalog.js): ipo-2 ships
 * 15 questions, ipo-3 ships 10. This script upserts those quizzes as
 * admin-owned overrides — the same documents the admin page reads/writes.
 *
 * Usage:
 *   node scripts/seed-ipo-quizzes.js            # insert missing only
 *   node scripts/seed-ipo-quizzes.js --dry-run  # print what would happen
 *   node scripts/seed-ipo-quizzes.js --force    # overwrite existing rows
 *
 * Idempotent and safe to re-run. Reads connection from .env
 * (MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE).
 */
import dotenv from 'dotenv';

dotenv.config();

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');

const { default: mongoose } = await import('mongoose');
const { getCourse } = await import('../src/modules/training/domain/Training.catalog.js');
const { TrainingQuizModel } = await import('../src/modules/training/infrastructure/TrainingQuiz.mongo.model.js');

const TARGETS = [
  { courseId: 'ipo', lessonId: 'ipo-2', expect: 15 },
  { courseId: 'ipo', lessonId: 'ipo-3', expect: 10 },
];

const username = process.env.MONGODB_USERNAME;
const password = process.env.MONGODB_PASSWORD;
const database = process.env.MONGODB_DATABASE;
if (!username || !password || !database) {
  console.error('Missing MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE in .env');
  process.exit(1);
}

let failures = 0;
try {
  await mongoose.connect(
    `mongodb+srv://${username}:${password}@cluster0.buvy2cx.mongodb.net/${database}?retryWrites=true&w=majority`,
  );

  for (const t of TARGETS) {
    const lesson = getCourse(t.courseId).lessons.find((l) => l.id === t.lessonId);
    if (!lesson) {
      console.error(`SKIP ${t.courseId}:${t.lessonId} — not in catalog`);
      failures += 1;
      continue;
    }
    if (lesson.quiz.length !== t.expect) {
      console.error(`SKIP ${t.courseId}:${t.lessonId} — catalog has ${lesson.quiz.length}, expected ${t.expect}`);
      failures += 1;
      continue;
    }
    const bad = lesson.quiz.findIndex(
      (q) => !q.q || !Array.isArray(q.options) || q.options.length < 2
        || q.options.length > 6 || !Number.isInteger(q.answer) || q.answer >= q.options.length,
    );
    if (bad !== -1) {
      console.error(`SKIP ${t.courseId}:${t.lessonId} — question ${bad + 1} fails admin validation`);
      failures += 1;
      continue;
    }

    const existing = await TrainingQuizModel.findOne({ courseId: t.courseId, lessonId: t.lessonId }).lean();
    if (existing && !FORCE) {
      console.log(`KEEP ${t.courseId}:${t.lessonId} — override already exists (${existing.quiz.length} questions); re-run with --force to replace`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`WOULD-WRITE ${t.courseId}:${t.lessonId} — ${lesson.quiz.length} questions (${existing ? 'overwrite' : 'insert'})`);
      continue;
    }
    await TrainingQuizModel.findOneAndUpdate(
      { courseId: t.courseId, lessonId: t.lessonId },
      { $set: { quiz: lesson.quiz } },
      { new: true, upsert: true },
    );
    console.log(`WROTE ${t.courseId}:${t.lessonId} — ${lesson.quiz.length} questions (${existing ? 'overwrote' : 'inserted'})`);
  }
} catch (err) {
  console.error('Seed failed:', err?.message ?? err);
  failures += 1;
} finally {
  await mongoose.disconnect().catch(() => null);
}
process.exit(failures > 0 ? 1 : 0);
