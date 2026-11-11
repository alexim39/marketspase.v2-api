import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CompleteLessonUseCase,
  GetCourseUseCase,
  ListCoursesUseCase,
  RecordWatchUseCase,
  WATCH_REQUIRED_PERCENT,
} from './Training.usecases.js';

const COURSE_ID = '507f1f77bcf86cd799439011';
const LESSON_1 = '507f1f77bcf86cd799439012';
const LESSON_2 = '507f1f77bcf86cd799439013';

const course = (over = {}) => ({
  id: COURSE_ID,
  title: 'IPO Foundations',
  tagline: 'Start with the business model',
  description: 'The first step.',
  milestone: 'ipo',
  coverUrl: null,
  status: 'published',
  sortOrder: 0,
  publishedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

const lesson = (id, order, over = {}) => ({
  id,
  courseId: COURSE_ID,
  title: `Lesson ${order + 1}`,
  summary: 'Summary',
  body: 'Study body',
  takeaways: ['One'],
  transcript: '',
  youtubeId: '6poBPhfB-WY',
  youtubeUrl: 'https://www.youtube.com/watch?v=6poBPhfB-WY',
  thumbnailUrl: 'https://i.ytimg.com/vi/6poBPhfB-WY/hqdefault.jpg',
  durationSec: 1000,
  quiz: [{ q: 'What matters?', options: ['Focus', 'Noise'], answer: 0 }],
  status: 'published',
  sortOrder: order,
  ...over,
});

const fakeRepo = ({ lessons = [lesson(LESSON_1, 0), lesson(LESSON_2, 1)], rows = [], watch = {} } = {}) => {
  const state = {
    lessons,
    rows: rows.map((row) => ({ completedLessons: [], certificateAt: null, ...row })),
    watch: { ...watch },
    recorded: [],
  };
  return {
    state,
    listPublishedCourses: async () => [course()],
    listByPartner: async () => state.rows,
    listLessonsForCourses: async () => state.lessons.filter((item) => item.status === 'published'),
    findPublishedCourseById: async () => course(),
    listPublishedLessons: async () => state.lessons.filter((item) => item.status === 'published'),
    findPublishedLesson: async (_courseId, id) => state.lessons.find((item) => item.id === id && item.status === 'published') ?? null,
    findByPartner: async () => state.rows[0] ?? null,
    getWatch: async () => state.watch,
    async completeLesson(_partnerId, _courseId, lessonId, certified) {
      const row = state.rows[0] ?? { completedLessons: [], certificateAt: null };
      if (!row.completedLessons.includes(lessonId)) row.completedLessons.push(lessonId);
      if (certified && !row.certificateAt) row.certificateAt = new Date('2026-11-10T10:00:00.000Z');
      state.rows[0] = row;
      return row;
    },
    async recordWatch(_partnerId, _courseId, lessonId, percent, seconds) {
      state.recorded.push({ lessonId, percent, seconds });
      state.watch[lessonId] = { percent, seconds, updatedAt: new Date().toISOString() };
      return { lessonId, percent, seconds, updatedAt: new Date().toISOString() };
    },
    findCoursesByIds: async () => [course()],
    listForPartners: async () => state.rows,
  };
};

const fakeProgress = (seed = {}) => {
  const state = { milestones: seed, writes: [] };
  return {
    state,
    findByPartner: async () => state.milestones,
    async upsertMilestones(_partnerId, patch, event) {
      state.writes.push({ patch, event });
      state.milestones = { ...state.milestones, ...patch };
      return state.milestones;
    },
  };
};

describe('dynamic training use cases', () => {
  it('lists only published courses and counts published lessons', async () => {
    const repo = fakeRepo({
      rows: [{ courseId: COURSE_ID, completedLessons: [LESSON_1], certificateAt: null }],
    });
    const result = await new ListCoursesUseCase({ training: repo }).execute({ partnerId: 'p1' });
    assert.equal(result.length, 1);
    assert.equal(result[0].done, 1);
    assert.equal(result[0].total, 2);
    assert.equal(result[0].percent, 50);
    assert.equal(result[0].estimatedMinutes, 33);
    assert.equal(result[0].nextLessonId, LESSON_2);
  });

  it('hides answer keys on unfinished lessons and reveals them after completion', async () => {
    const repo = fakeRepo({
      rows: [{ courseId: COURSE_ID, completedLessons: [LESSON_1], certificateAt: null }],
    });
    const result = await new GetCourseUseCase({ training: repo }).execute({ partnerId: 'p1', courseId: COURSE_ID });
    const first = result.lessons.find((item) => item.id === LESSON_1);
    const second = result.lessons.find((item) => item.id === LESSON_2);
    assert.equal(first.completed, true);
    assert.equal(first.quiz[0].answer, 0);
    assert.equal(second.completed, false);
    assert.equal(second.quiz[0].answer, undefined);
  });

  it(`blocks completion until ${WATCH_REQUIRED_PERCENT}% is verified`, async () => {
    const usecase = new CompleteLessonUseCase({ training: fakeRepo(), progress: null, recognition: null, network: null });
    await assert.rejects(
      usecase.execute({ partnerId: 'p1', courseId: COURSE_ID, lessonId: LESSON_1, answers: [0] }),
      /Watch the video before completing \(0% of 90% watched\)/,
    );
  });

  it('still enforces the quiz after the watch gate', async () => {
    const repo = fakeRepo({ watch: { [LESSON_1]: { percent: 95, seconds: 950 } } });
    const usecase = new CompleteLessonUseCase({ training: repo, progress: null, recognition: null, network: null });
    await assert.rejects(
      usecase.execute({ partnerId: 'p1', courseId: COURSE_ID, lessonId: LESSON_1, answers: [1] }),
      /incorrect/,
    );
  });

  it('issues a certificate and records the course milestone after the final lesson', async () => {
    const repo = fakeRepo({
      rows: [{ courseId: COURSE_ID, completedLessons: [LESSON_1], certificateAt: null }],
      watch: { [LESSON_2]: { percent: 95, seconds: 950 } },
    });
    const progress = fakeProgress();
    const usecase = new CompleteLessonUseCase({ training: repo, progress, recognition: null, network: null });
    const result = await usecase.execute({
      partnerId: 'p1',
      courseId: COURSE_ID,
      lessonId: LESSON_2,
      answers: [0],
    });
    assert.equal(result.certified, true);
    assert.equal(result.progress.percent, 100);
    assert.equal(result.milestoneChecked, 'ipo');
    assert.equal(progress.state.writes.length, 1);
    assert.equal(progress.state.writes[0].patch.ipo.done, true);
  });

  it('does not duplicate a milestone already earned from another course', async () => {
    const repo = fakeRepo({
      rows: [{ courseId: COURSE_ID, completedLessons: [LESSON_1], certificateAt: null }],
      watch: { [LESSON_2]: { percent: 95, seconds: 950 } },
    });
    const progress = fakeProgress({ ipo: { done: true } });
    const usecase = new CompleteLessonUseCase({ training: repo, progress, recognition: null, network: null });
    const result = await usecase.execute({
      partnerId: 'p1',
      courseId: COURSE_ID,
      lessonId: LESSON_2,
      answers: [0],
    });
    assert.equal(result.certified, true);
    assert.equal(result.milestoneChecked, null);
    assert.equal(result.milestoneAlreadyRecorded, true);
    assert.equal(progress.state.writes.length, 0);
  });

  it('elective courses issue certificates without touching rank', async () => {
    const elective = course({ milestone: null });
    const repo = fakeRepo({
      rows: [{ courseId: COURSE_ID, completedLessons: [LESSON_1], certificateAt: null }],
      watch: { [LESSON_2]: { percent: 95, seconds: 950 } },
    });
    repo.findPublishedCourseById = async () => elective;
    const progress = fakeProgress();
    const usecase = new CompleteLessonUseCase({ training: repo, progress, recognition: null, network: null });
    const result = await usecase.execute({
      partnerId: 'p1',
      courseId: COURSE_ID,
      lessonId: LESSON_2,
      answers: [0],
    });
    assert.equal(result.certified, true);
    assert.equal(result.milestoneChecked, null);
    assert.equal(progress.state.writes.length, 0);
  });

  it('records verified watch seconds and rejects a forward jump', async () => {
    const repo = fakeRepo();
    const usecase = new RecordWatchUseCase({ training: repo });
    await assert.rejects(
      usecase.execute({ partnerId: 'p1', courseId: COURSE_ID, lessonId: LESSON_1, percent: 90, seconds: 900 }),
      /must start from the beginning|jumped too fast/,
    );
    repo.state.watch[LESSON_1] = {
      percent: 20,
      seconds: 200,
      updatedAt: new Date(Date.now() - 60000).toISOString(),
    };
    const result = await usecase.execute({
      partnerId: 'p1',
      courseId: COURSE_ID,
      lessonId: LESSON_1,
      percent: 28,
      seconds: 280,
    });
    assert.equal(result.percent, 28);
    assert.equal(repo.state.recorded.at(-1).seconds, 280);
  });
});
