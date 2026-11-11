import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCoursePublishable,
  assertLessonPublishable,
  cleanCourseInput,
  cleanLessonInput,
  courseProgress,
  publicQuiz,
  verifiedWatchPercent,
} from './Training.domain.js';

const lesson = (id, status = 'published', extra = {}) => ({
  id,
  status,
  youtubeId: 'abcdefghijk',
  durationSec: 600,
  sortOrder: 0,
  ...extra,
});

describe('dynamic training domain', () => {
  it('normalises a course and rejects an invalid milestone', () => {
    const course = cleanCourseInput({
      title: '  IPO Foundations  ',
      tagline: 'Start strong',
      description: 'A course',
      milestone: 'IPO',
      coverUrl: 'https://cdn.example.com/cover.jpg',
    });
    assert.equal(course.title, 'IPO Foundations');
    assert.equal(course.milestone, 'ipo');
    assert.throws(
      () => cleanCourseInput({ title: 'Valid title', milestone: 'gold' }),
      /valid rank milestone/,
    );
  });

  it('accepts a YouTube watch, short or embed link and canonicalises it', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=6poBPhfB-WY',
      'https://youtu.be/6poBPhfB-WY',
      'https://www.youtube.com/shorts/6poBPhfB-WY',
      'https://www.youtube-nocookie.com/embed/6poBPhfB-WY',
      '6poBPhfB-WY',
    ]) {
      const patch = cleanLessonInput({ title: 'A lesson', youtubeUrl: url });
      assert.equal(patch.youtubeId, '6poBPhfB-WY');
      assert.equal(patch.youtubeUrl, 'https://www.youtube.com/watch?v=6poBPhfB-WY');
    }
    assert.throws(
      () => cleanLessonInput({ title: 'A lesson', youtubeUrl: 'https://example.com/video' }),
      /valid YouTube/,
    );
  });

  it('hides quiz answer keys until the lesson is complete', () => {
    const quiz = [{ q: 'Question?', options: ['A', 'B'], answer: 1 }];
    assert.deepEqual(publicQuiz(quiz, { completed: false }), [{ q: 'Question?', options: ['A', 'B'] }]);
    assert.deepEqual(publicQuiz(quiz, { completed: true }), quiz);
  });

  it('counts only published lessons in member progress', () => {
    const progress = courseProgress({
      lessons: [lesson('a'), lesson('b', 'draft'), lesson('c')],
      completedLessons: ['a', 'b'],
    });
    assert.equal(progress.total, 2);
    assert.equal(progress.done, 1);
    assert.equal(progress.percent, 50);
    assert.equal(progress.nextLessonId, 'c');
    assert.equal(progress.allDone, false);
  });

  it('requires at least one published video lesson before publishing a course', () => {
    assert.throws(() => assertCoursePublishable([]), /at least one lesson/);
    assert.throws(
      () => assertCoursePublishable([lesson('a', 'published', { youtubeId: null })]),
      /YouTube video/,
    );
    assert.doesNotThrow(() => assertCoursePublishable([lesson('a')]));
    assert.throws(
      () => assertLessonPublishable({ status: 'published', youtubeId: null, durationSec: 10 }),
      /YouTube video/,
    );
    assert.throws(
      () => assertLessonPublishable({ status: 'published', youtubeId: 'abcdefghijk', durationSec: 0 }),
      /video duration/,
    );
    assert.doesNotThrow(() => assertLessonPublishable({ status: 'published', youtubeId: 'abcdefghijk', durationSec: 60 }));
  });

  it('derives verified percent from playback seconds, not the client claim', () => {
    assert.equal(verifiedWatchPercent({ seconds: 30, percent: 90, durationSec: 100 }), 30);
    assert.equal(verifiedWatchPercent({ seconds: 95, percent: 95, durationSec: 100 }), 95);
    assert.equal(verifiedWatchPercent({ seconds: 0, percent: 80, durationSec: 0 }), 80);
  });
});
