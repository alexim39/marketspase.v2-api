import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateCourseUseCase,
  CreateLessonUseCase,
  GetAdminCourseUseCase,
  ListAdminCoursesUseCase,
  UpdateCourseUseCase,
  UpdateLessonUseCase,
} from './Training.admin.usecases.js';

const ID = (n) => `507f1f77bcf86cd7994390${String(n).padStart(2, '0')}`;

const fakeTraining = ({ courses = [], lessons = [] } = {}) => {
  const state = { courses: [...courses], lessons: [...lessons] };
  return {
    state,
    listCourses: async () => [...state.courses],
    findCourseById: async (id) => state.courses.find((course) => course.id === id) ?? null,
    createCourse: async (data) => {
      const course = { id: ID(50), ...data };
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
    listLessons: async (courseId) => state.lessons.filter((lesson) => lesson.courseId === courseId),
    listLessonsForCourses: async (ids) => state.lessons.filter((lesson) => ids.includes(lesson.courseId)),
    listPublishedLessons: async (courseId) => state.lessons.filter(
      (lesson) => lesson.courseId === courseId && lesson.status === 'published',
    ),
    findLessonById: async (courseId, id) => state.lessons.find(
      (lesson) => lesson.courseId === courseId && lesson.id === id,
    ) ?? null,
    createLesson: async (courseId, data) => {
      const lesson = { id: ID(60), courseId, ...data };
      state.lessons.push(lesson);
      return lesson;
    },
    updateLesson: async (courseId, id, patch) => {
      const index = state.lessons.findIndex((lesson) => lesson.courseId === courseId && lesson.id === id);
      if (index < 0) return null;
      state.lessons[index] = { ...state.lessons[index], ...patch };
      return state.lessons[index];
    },
    deleteLesson: async (courseId, id) => {
      const index = state.lessons.findIndex((lesson) => lesson.courseId === courseId && lesson.id === id);
      if (index < 0) return null;
      const [removed] = state.lessons.splice(index, 1);
      return removed;
    },
    nextLessonOrder: async (courseId) => state.lessons.filter((lesson) => lesson.courseId === courseId).length,
    reorderCourses: async (ids) => {
      state.courses.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      return state.courses;
    },
    reorderLessons: async (courseId, ids) => {
      state.lessons.sort((a, b) => {
        if (a.courseId !== b.courseId) return 0;
        return ids.indexOf(a.id) - ids.indexOf(b.id);
      });
      return state.lessons;
    },
  };
};

const fullLesson = (over = {}) => ({
  id: ID(1),
  courseId: ID(10),
  title: 'What the business is',
  summary: '',
  body: '',
  takeaways: [],
  transcript: '',
  youtubeId: '6poBPhfB-WY',
  youtubeUrl: 'https://www.youtube.com/watch?v=6poBPhfB-WY',
  thumbnailUrl: 'https://i.ytimg.com/vi/6poBPhfB-WY/hqdefault.jpg',
  durationSec: 600,
  quiz: [{ q: 'What matters?', options: ['A', 'B'], answer: 0 }],
  status: 'published',
  sortOrder: 0,
  ...over,
});

const fullCourse = (over = {}) => ({
  id: ID(10),
  title: 'IPO Foundations',
  tagline: '',
  description: '',
  milestone: 'ipo',
  coverUrl: null,
  status: 'published',
  sortOrder: 0,
  publishedAt: new Date('2026-11-01T00:00:00.000Z'),
  archivedAt: null,
  ...over,
});

describe('Training Studio use cases', () => {
  it('creates new courses as drafts and warns when a milestone already has a published course', async () => {
    const training = fakeTraining({ courses: [fullCourse()] });
    const usecase = new CreateCourseUseCase({ training });
    const created = await usecase.execute({
      adminId: ID(99),
      input: {
        title: 'IPO Fast Track',
        tagline: 'Another route',
        milestone: 'ipo',
      },
    });
    assert.equal(created.status, 'draft');
    assert.equal(created.milestone, 'ipo');
    assert.equal(created.warnings.length, 1);
    assert.match(created.warnings[0].message, /already awards IPO/);
  });

  it('lists all courses including drafts, with lesson readiness counts', async () => {
    const training = fakeTraining({
      courses: [fullCourse()],
      lessons: [fullLesson()],
    });
    const result = await new ListAdminCoursesUseCase({ training }).execute();
    assert.equal(result.length, 1);
    assert.equal(result[0].lessonCount, 1);
    assert.equal(result[0].publishedLessonCount, 1);
    assert.equal(result[0].estimatedMinutes, 10);
  });

  it('refuses to publish a course before a published video lesson exists', async () => {
    const training = fakeTraining({ courses: [fullCourse({ status: 'draft', publishedAt: null })] });
    const usecase = new UpdateCourseUseCase({ training });
    await assert.rejects(
      usecase.execute({ courseId: ID(10), input: { status: 'published' } }),
      /Publish at least one lesson/,
    );
  });

  it('publishes a course after a YouTube lesson is published', async () => {
    const training = fakeTraining({
      courses: [fullCourse({ status: 'draft', publishedAt: null })],
      lessons: [fullLesson()],
    });
    const usecase = new UpdateCourseUseCase({ training });
    const result = await usecase.execute({ courseId: ID(10), input: { status: 'published' } });
    assert.equal(result.status, 'published');
    assert.equal(result.lessons.length, 1);
  });

  it('requires a YouTube link before publishing a lesson', async () => {
    const training = fakeTraining({ courses: [fullCourse({ status: 'draft' })] });
    const usecase = new CreateLessonUseCase({ training });
    await assert.rejects(
      usecase.execute({
        courseId: ID(10),
        input: { title: 'No video yet', youtubeUrl: null, status: 'published' },
      }),
      /YouTube video/,
    );
  });

  it('creates a draft lesson, then publishes it with a YouTube link', async () => {
    const training = fakeTraining({ courses: [fullCourse({ status: 'draft' })] });
    const create = new CreateLessonUseCase({ training });
    const draft = await create.execute({
      courseId: ID(10),
      input: { title: 'A new lesson', youtubeUrl: null, status: 'draft' },
    });
    assert.equal(draft.status, 'draft');
    const update = new UpdateLessonUseCase({ training });
    const published = await update.execute({
      courseId: ID(10),
      lessonId: draft.id,
      input: {
        youtubeUrl: 'https://youtu.be/6poBPhfB-WY',
        durationSec: 600,
        status: 'published',
      },
    });
    assert.equal(published.status, 'published');
    assert.equal(published.youtubeId, '6poBPhfB-WY');
  });

  it('returns the complete admin lesson payload for the studio editor', async () => {
    const training = fakeTraining({
      courses: [fullCourse()],
      lessons: [fullLesson({ body: 'Study text', quiz: [{ q: 'Question?', options: ['A', 'B'], answer: 0 }] })],
    });
    const result = await new GetAdminCourseUseCase({ training }).execute({ courseId: ID(10) });
    assert.equal(result.lessons[0].body, 'Study text');
    assert.equal(result.lessons[0].quiz[0].answer, 0);
    assert.equal(result.lessons[0].isReady, true);
  });
});
