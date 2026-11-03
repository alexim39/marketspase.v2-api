import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCourseWithQuiz, getCourseWithQuizFull } from '../domain/Training.catalog.js';
import { MediaSchema } from '../interface/AdminTraining.routes.js';

const IPO_VIDEO = '/courses/ipo/ipo-first-lesson-by-Prof-BB-July-2026.mp4';

const storeWithMedia = (mediaByLesson) => ({
  getQuiz: async () => null,
  getMedia: async (courseId, lessonId) => mediaByLesson[`${courseId}:${lessonId}`] ?? null,
});

describe('media overrides', () => {
  it('override fields win, null fields fall back to catalog', async () => {
    const course = await getCourseWithQuizFull('ipo', storeWithMedia({
      'ipo:ipo-1': {
        videoUrl: 'https://cdn.example.com/ipo1.mp4',
        posterUrl: null, captionsUrl: null, transcript: null, durationSec: null,
      },
    }));
    const l1 = course.lessons.find((l) => l.id === 'ipo-1');
    assert.equal(l1.videoUrl, 'https://cdn.example.com/ipo1.mp4');
    assert.equal(l1.captionsUrl, '/courses/ipo/ipo-1.vtt'); // catalog fallback
    assert.ok((l1.transcript ?? '').length > 50); // catalog fallback
    assert.equal(l1.durationSec, 2445);
  });

  it('all-null override leaves the catalog untouched', async () => {
    const course = await getCourseWithQuizFull('ipo', storeWithMedia({
      'ipo:ipo-1': { videoUrl: null, posterUrl: null, captionsUrl: null, transcript: null, durationSec: null },
    }));
    assert.equal(course.lessons.find((l) => l.id === 'ipo-1').videoUrl, IPO_VIDEO);
  });

  it('stores without getMedia keep working (backward compatible)', async () => {
    const course = await getCourseWithQuizFull('ipo', { getQuiz: async () => null });
    assert.equal(course.lessons.find((l) => l.id === 'ipo-1').videoUrl, IPO_VIDEO);
  });

  it('public payload carries merged media', async () => {
    const course = await getCourseWithQuiz('ipo', storeWithMedia({
      'ipo:ipo-2': { videoUrl: '/courses/ipo/ipo-2.mp4', posterUrl: null, captionsUrl: null, transcript: 'Hello', durationSec: 600 },
    }));
    const l2 = course.lessons.find((l) => l.id === 'ipo-2');
    assert.equal(l2.videoUrl, '/courses/ipo/ipo-2.mp4');
    assert.equal(l2.transcript, 'Hello');
    assert.equal(l2.durationSec, 600);
  });

  it('body/takeaways overrides win, empty falls back to catalog', async () => {
    const course = await getCourseWithQuizFull('ipo', storeWithMedia({
      'ipo:ipo-3': { body: 'Custom body\n\nSecond para.', takeaways: ['One', 'Two'] },
    }));
    const l3 = course.lessons.find((l) => l.id === 'ipo-3');
    assert.equal(l3.body, 'Custom body\n\nSecond para.');
    assert.deepEqual(l3.takeaways, ['One', 'Two']);
    const l1 = course.lessons.find((l) => l.id === 'ipo-1');
    assert.ok((l1.body ?? '').length > 50); // catalog fallback untouched
  });
});

describe('MediaSchema', () => {
  it('accepts https URLs and site-relative paths', () => {
    const ok = MediaSchema.parse({
      videoUrl: 'https://res.cloudinary.com/x/video/upload/v1.mp4',
      posterUrl: '/courses/ipo/poster.jpg',
      captionsUrl: null,
      transcript: 'Hi',
      durationSec: 120,
    });
    assert.equal(ok.videoUrl, 'https://res.cloudinary.com/x/video/upload/v1.mp4');
  });

  it('accepts empty and null fields (partial overrides)', () => {
    const ok = MediaSchema.parse({ videoUrl: '', transcript: null });
    assert.equal(ok.videoUrl, '');
  });

  it('rejects non-URL strings and oversized input', () => {
    assert.throws(() => MediaSchema.parse({ videoUrl: 'not a url' }));
    assert.throws(() => MediaSchema.parse({ videoUrl: 'ftp://x/y.mp4' }));
    assert.throws(() => MediaSchema.parse({ durationSec: -1 }));
    assert.throws(() => MediaSchema.parse({ transcript: 'x'.repeat(8001) }));
    assert.throws(() => MediaSchema.parse({ body: 'x'.repeat(20001) }));
    assert.throws(() => MediaSchema.parse({ takeaways: Array(11).fill('ok') }));
  });

  it('accepts body + takeaways overrides', () => {
    const ok = MediaSchema.parse({ body: 'Para one.\n\nPara two.', takeaways: ['First', 'Second'] });
    assert.equal(ok.body, 'Para one.\n\nPara two.');
    assert.deepEqual(ok.takeaways, ['First', 'Second']);
  });
});
