import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildTrainingRouter } from './Training.routes.js';
import { buildAdminTrainingRouter } from './AdminTraining.routes.js';

const COURSE_ID = '507f1f77bcf86cd799439011';
const LESSON_ID = '507f1f77bcf86cd799439012';
const PARTNER_ID = '507f1f77bcf86cd799439099';

const baseCourse = (over = {}) => ({
  id: COURSE_ID,
  title: 'IPO Foundations',
  tagline: 'Start strong',
  description: 'The foundation course.',
  milestone: 'ipo',
  coverUrl: null,
  status: 'published',
  sortOrder: 0,
  publishedAt: new Date('2026-11-01T00:00:00.000Z'),
  archivedAt: null,
  ...over,
});

const baseLesson = (over = {}) => ({
  id: LESSON_ID,
  courseId: COURSE_ID,
  title: 'What the business is',
  summary: 'A short introduction',
  body: 'Study text',
  takeaways: ['One thing'],
  transcript: '',
  youtubeId: '6poBPhfB-WY',
  youtubeUrl: 'https://www.youtube.com/watch?v=6poBPhfB-WY',
  thumbnailUrl: 'https://i.ytimg.com/vi/6poBPhfB-WY/hqdefault.jpg',
  durationSec: 100,
  quiz: [{ q: 'What matters?', options: ['Focus', 'Noise'], answer: 0 }],
  status: 'published',
  sortOrder: 0,
  ...over,
});

const fakeStore = ({ courses = [baseCourse()], lessons = [baseLesson()] } = {}) => {
  const state = {
    courses: [...courses],
    lessons: [...lessons],
    progress: [],
    nextCourse: 30,
    nextLesson: 40,
  };
  return {
    state,
    listCourses: async () => [...state.courses],
    listPublishedCourses: async () => state.courses.filter((course) => course.status === 'published'),
    listLessonsForCourses: async (ids, { status } = {}) => state.lessons.filter(
      (lesson) => ids.includes(lesson.courseId) && (!status || lesson.status === status),
    ),
    listLessons: async (courseId) => state.lessons.filter((lesson) => lesson.courseId === courseId),
    findCourseById: async (id) => state.courses.find((course) => course.id === id) ?? null,
    findPublishedCourseById: async (id) => state.courses.find(
      (course) => course.id === id && course.status === 'published',
    ) ?? null,
    createCourse: async (data) => {
      const course = { id: `507f1f77bcf86cd7994390${state.nextCourse++}`, ...data };
      state.courses.push(course);
      return course;
    },
    updateCourse: async (id, patch) => {
      const index = state.courses.findIndex((course) => course.id === id);
      if (index < 0) return null;
      state.courses[index] = { ...state.courses[index], ...patch };
      return state.courses[index];
    },
    publishedMilestoneConflict: async (milestone, excludeId) => state.courses.find(
      (course) => course.milestone === milestone && course.status === 'published' && course.id !== excludeId,
    ) ?? null,
    nextCourseOrder: async () => state.courses.length,
    listPublishedLessons: async (courseId) => state.lessons.filter(
      (lesson) => lesson.courseId === courseId && lesson.status === 'published',
    ),
    findPublishedLesson: async (courseId, id) => state.lessons.find(
      (lesson) => lesson.courseId === courseId && lesson.id === id && lesson.status === 'published',
    ) ?? null,
    findLessonById: async (courseId, id) => state.lessons.find(
      (lesson) => lesson.courseId === courseId && lesson.id === id,
    ) ?? null,
    createLesson: async (courseId, data) => {
      const lesson = { id: `507f1f77bcf86cd7994390${state.nextLesson++}`, courseId, ...data };
      state.lessons.push(lesson);
      return lesson;
    },
    updateLesson: async (courseId, id, patch) => {
      const index = state.lessons.findIndex((lesson) => lesson.courseId === courseId && lesson.id === id);
      if (index < 0) return null;
      state.lessons[index] = { ...state.lessons[index], ...patch };
      return state.lessons[index];
    },
    nextLessonOrder: async (courseId) => state.lessons.filter((lesson) => lesson.courseId === courseId).length,
    deleteLesson: async (courseId, id) => {
      const index = state.lessons.findIndex((lesson) => lesson.courseId === courseId && lesson.id === id);
      if (index < 0) return null;
      const [removed] = state.lessons.splice(index, 1);
      return removed;
    },
    reorderCourses: async () => [],
    reorderLessons: async (courseId) => state.lessons.filter((lesson) => lesson.courseId === courseId),
    findByPartner: async () => state.progress[0] ?? null,
    listByPartner: async () => state.progress,
    getWatch: async () => state.progress[0]?.watch ?? {},
    recordWatch: async (_partnerId, _courseId, lessonId, percent, seconds) => {
      const row = state.progress[0] ?? { completedLessons: [], certificateAt: null, watch: {} };
      row.watch = { ...(row.watch ?? {}), [lessonId]: { percent, seconds, updatedAt: new Date(Date.now() - 700000).toISOString() } };
      state.progress[0] = row;
      return { lessonId, percent, seconds, updatedAt: new Date().toISOString() };
    },
    completeLesson: async (_partnerId, courseId, lessonId, certified) => {
      const row = state.progress[0] ?? { courseId, completedLessons: [], certificateAt: null, watch: {} };
      if (!row.completedLessons.includes(lessonId)) row.completedLessons.push(lessonId);
      if (certified && !row.certificateAt) row.certificateAt = new Date('2026-11-10T10:00:00.000Z');
      state.progress[0] = row;
      return row;
    },
    findCoursesByIds: async (ids) => state.courses.filter((course) => ids.includes(course.id)),
    listForPartners: async () => state.progress,
  };
};

const auth = (req, _res, next) => {
  req.auth = { partnerId: PARTNER_ID };
  next();
};
const allow = (_req, _res, next) => next();
const progress = {
  findByPartner: async () => null,
  upsertMilestones: async () => ({}),
};

let server;
let base;

before(async () => {
  const training = fakeStore();
  const app = express();
  app.use(express.json());
  app.use('/v1/training', buildTrainingRouter({
    training,
    progress,
    recognition: null,
    network: {},
    auth,
    progression: { execute: async () => ({ level: 'partner' }) },
    stored: { findByKey: async () => null },
    notify: { execute: async () => ({}) },
    community: {},
    orders: {},
    prospects: {},
    eventStore: {},
  }));
  app.use('/v1/admin/training', buildAdminTrainingRouter({
    training,
    auth,
    admin: allow,
    audit: async () => null,
  }));
  app.use((err, _req, res, _next) => {
    res.status(err?.statusCode || 500).json({ message: err?.message ?? 'Invalid request', success: false });
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('dynamic training routes', () => {
  it('serves the Academy catalogue and a lesson with hidden answers', async () => {
    const list = await fetch(`${base}/v1/training/courses`);
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(listBody.data[0].title, 'IPO Foundations');
    assert.equal(listBody.data[0].total, 1);

    const detail = await fetch(`${base}/v1/training/courses/${COURSE_ID}`);
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.equal(detailBody.data.lessons[0].quiz[0].answer, undefined);
  });

  it('records watch progress and then completes the lesson', async () => {
    const watch = await fetch(`${base}/v1/training/courses/${COURSE_ID}/lessons/${LESSON_ID}/watch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ percent: 10, seconds: 10 }),
    });
    assert.equal(watch.status, 200);
    const watchBody = await watch.json();
    assert.equal(watchBody.data.percent, 10);

    const blocked = await fetch(`${base}/v1/training/courses/${COURSE_ID}/lessons/${LESSON_ID}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [0] }),
    });
    assert.equal(blocked.status, 400);

    for (const [percent, seconds] of [[35, 35], [60, 60], [85, 85], [95, 95]]) {
      const step = await fetch(`${base}/v1/training/courses/${COURSE_ID}/lessons/${LESSON_ID}/watch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ percent, seconds }),
      });
      assert.equal(step.status, 200);
    }

    const complete = await fetch(`${base}/v1/training/courses/${COURSE_ID}/lessons/${LESSON_ID}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [0] }),
    });
    assert.equal(complete.status, 200);
    const completeBody = await complete.json();
    assert.equal(completeBody.data.certified, true);
    assert.equal(completeBody.data.milestoneChecked, 'ipo');
  });

  it('creates and publishes an admin-built course and lesson', async () => {
    const created = await fetch(`${base}/v1/admin/training/courses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'QSG Fast Track',
        tagline: 'Questions, stories and goals',
        milestone: 'qsg',
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    const courseId = createdBody.data.id;
    assert.equal(createdBody.data.status, 'draft');

    const lesson = await fetch(`${base}/v1/admin/training/courses/${courseId}/lessons`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'The first conversation',
        youtubeUrl: 'https://youtu.be/6poBPhfB-WY',
        durationSec: 600,
        quiz: [{ q: 'What comes first?', options: ['Questions', 'Pitch'], answer: 0 }],
        status: 'published',
      }),
    });
    assert.equal(lesson.status, 201);

    const published = await fetch(`${base}/v1/admin/training/courses/${courseId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    });
    assert.equal(published.status, 200);
    const publishedBody = await published.json();
    assert.equal(publishedBody.data.status, 'published');
  });

  it('rejects invalid YouTube links and incomplete course publishing', async () => {
    const invalid = await fetch(`${base}/v1/admin/training/courses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A course', milestone: 'ipo' }),
    });
    assert.equal(invalid.status, 201);
    const invalidBody = await invalid.json();

    const publish = await fetch(`${base}/v1/admin/training/courses/${invalidBody.data.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    });
    assert.equal(publish.status, 400);

    const badVideo = await fetch(`${base}/v1/admin/training/courses/${invalidBody.data.id}/lessons`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Bad link', youtubeUrl: 'https://example.com/nope', status: 'published' }),
    });
    assert.equal(badVideo.status, 400);
  });
});
