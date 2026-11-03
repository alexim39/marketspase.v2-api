import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogSummaries,
  courseProgress,
  COURSES,
  getCourse,
  getCourseWithQuiz,
  getCourseWithQuizFull,
  getLessonWithQuiz,
} from './Training.catalog.js';

const noQuizStore = { getQuiz: async () => null };

describe('courseProgress', () => {
  it('empty completion is 0% and uncertified', () => {
    const course = getCourse('ipo');
    const p = courseProgress(course, []);
    assert.equal(p.done, 0);
    assert.equal(p.total, 3);
    assert.equal(p.percent, 0);
    assert.equal(p.certified, false);
    assert.deepEqual(p.completedIds, []);
  });

  it('partial completion rounds percent', () => {
    const course = getCourse('ipo');
    const p = courseProgress(course, ['ipo-1']);
    assert.equal(p.done, 1);
    assert.equal(p.percent, 33);
    assert.equal(p.certified, false);
  });

  it('full completion certifies', () => {
    const course = getCourse('ipo');
    const p = courseProgress(course, ['ipo-1', 'ipo-2', 'ipo-3']);
    assert.equal(p.done, 3);
    assert.equal(p.percent, 100);
    assert.equal(p.certified, true);
  });

  it('ignores unknown ids and dedupes repeats', () => {
    const course = getCourse('ipo');
    const p = courseProgress(course, ['ipo-1', 'ipo-1', 'nope', 'qsg-1']);
    assert.deepEqual(p.completedIds, ['ipo-1']);
    assert.equal(p.done, 1);
  });

  it('catalog carries the ipo video + captions + transcript', () => {
    const course = getCourse('ipo');
    const l1 = course.lessons.find((l) => l.id === 'ipo-1');
    assert.equal(l1.videoUrl, '/courses/ipo/ipo-first-lesson-by-Prof-BB-July-2026.mp4');
    assert.equal(l1.captionsUrl, '/courses/ipo/ipo-1.vtt');
    assert.ok((l1.transcript ?? '').length > 50);
    assert.equal(l1.durationSec, 2445);
  });

  it('ipo-2 carries the commissions video + 15-question quiz', () => {
    const course = getCourse('ipo');
    const l2 = course.lessons.find((l) => l.id === 'ipo-2');
    assert.equal(l2.videoUrl, '/courses/ipo/FINANCIAL-ARCHITECTURAL-BLUEPRINT-GODS-WAY.mp4');
    assert.equal(l2.durationSec, 2764);
    assert.ok((l2.transcript ?? '').length > 50);
    assert.equal(l2.quiz.length, 15);
    assert.ok(l2.quiz.every((q) => q.options.length === 3 && Number.isInteger(q.answer)));
  });

  it('ipo-3 carries the first-30-days video + motivational lesson + 10-question quiz', () => {
    const course = getCourse('ipo');
    const l3 = course.lessons.find((l) => l.id === 'ipo-3');
    assert.equal(l3.videoUrl, '/courses/ipo/The-First-Step-For-Network-Marketing-Success.mp4');
    assert.equal(l3.durationSec, 545);
    assert.ok((l3.body ?? '').length > 200);
    assert.ok((l3.transcript ?? '').length > 50);
    assert.equal(l3.quiz.length, 10);
    assert.ok(l3.quiz.every((q) => q.options.length === 3 && Number.isInteger(q.answer)));
  });

  it('catalog summaries stay counts (detail shape is separate)', () => {
    const summaries = catalogSummaries();
    assert.equal(summaries.find((c) => c.id === 'ipo').lessons, 3);
  });
});

describe('quiz answer stripping', () => {
  it('public course payload carries questions but no answers', async () => {
    const course = await getCourseWithQuiz('ipo', noQuizStore);
    const quiz = course.lessons.find((l) => l.id === 'ipo-1').quiz;
    assert.ok(quiz.length > 0);
    for (const q of quiz) {
      assert.ok(q.q);
      assert.ok(Array.isArray(q.options));
      assert.equal('answer' in q, false);
    }
  });

  it('reveals answer keys only for completed lessons', async () => {
    const course = await getCourseWithQuiz('ipo', noQuizStore, ['ipo-1']);
    const l1 = course.lessons.find((l) => l.id === 'ipo-1');
    const l2 = course.lessons.find((l) => l.id === 'ipo-2');
    assert.ok(l1.quiz.every((q) => Number.isInteger(q.answer)));
    assert.ok(l2.quiz.every((q) => !('answer' in q)));
  });

  it('unknown ids in revealFor are ignored', async () => {
    const course = await getCourseWithQuiz('ipo', noQuizStore, ['nope']);
    assert.ok(course.lessons.every((l) => (l.quiz ?? []).every((q) => !('answer' in q))));
  });

  it('server-side lesson lookup keeps answers for validation', async () => {
    const { lesson } = await getLessonWithQuiz('ipo', 'ipo-1', noQuizStore);
    assert.ok(lesson.quiz.every((q) => Number.isInteger(q.answer)));
  });

  it('full internal payload keeps answers', async () => {
    const course = await getCourseWithQuizFull('ipo', noQuizStore);
    assert.ok(course.lessons.find((l) => l.id === 'ipo-1').quiz[0].answer !== undefined);
  });

  it('unknown course / lesson throw', async () => {
    await assert.rejects(() => getCourseWithQuiz('nope', noQuizStore), /Unknown course/);
    await assert.rejects(() => getLessonWithQuiz('ipo', 'nope', noQuizStore), /Unknown lesson/);
  });
});

describe('catalog completeness (IPO bar)', () => {
  it('every lesson ships body, takeaways, quiz and transcript', () => {
    for (const c of COURSES) {
      assert.ok(c.lessons.length > 0, `${c.id} has lessons`);
      for (const l of c.lessons) {
        assert.ok(String(l.body ?? '').trim().length > 50, `${c.id}/${l.id} body`);
        assert.ok((l.takeaways ?? []).length >= 2, `${c.id}/${l.id} takeaways`);
        assert.ok((l.quiz ?? []).length >= 2, `${c.id}/${l.id} quiz`);
        for (const q of l.quiz ?? []) {
          assert.ok(q.q && (q.options ?? []).length >= 3, `${c.id}/${l.id} quiz options`);
          assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, `${c.id}/${l.id} quiz answer`);
        }
        assert.ok(String(l.transcript ?? '').trim().length > 50, `${c.id}/${l.id} transcript`);
        // Video is optional (in production) but must be a valid path when set.
        if (l.videoUrl !== null && l.videoUrl !== undefined) {
          assert.match(String(l.videoUrl), /^(https:\/\/|\/courses\/)/, `${c.id}/${l.id} videoUrl`);
        }
      }
    }
  });

  it('ladder milestones are wired (ipo/qsg/smo)', () => {
    const byMilestone = Object.fromEntries(COURSES.filter((c) => c.milestone).map((c) => [c.milestone, c.id]));
    assert.equal(byMilestone.ipo, 'ipo');
    assert.equal(byMilestone.qsg, 'qsg');
    assert.equal(byMilestone.smo, 'smo');
  });
});
