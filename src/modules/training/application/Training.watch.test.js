import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CompleteLessonUseCase,
  RecordWatchUseCase,
  WATCH_REQUIRED_PERCENT,
} from './Training.usecases.js';

const IPO_CORRECT = [1, 1]; // ipo-1 quiz answers, in order

const fakeTraining = (watchMap = {}, recorded = []) => ({
  getQuiz: async () => null,
  findByPartner: async () => null,
  completeLesson: async (partnerId, courseId, lessonId, certified) => ({
    partnerId, courseId, completedLessons: [lessonId],
    certificateAt: certified ? new Date() : null,
  }),
  getWatch: async () => watchMap,
  recordWatch: async (partnerId, courseId, lessonId, percent, seconds) => {
    recorded.push({ partnerId, courseId, lessonId, percent, seconds });
    return { lessonId, percent, seconds, updatedAt: new Date().toISOString() };
  },
});

describe('video watch gate (CompleteLessonUseCase)', () => {
  it(`requires ${WATCH_REQUIRED_PERCENT}% before completing a video lesson`, async () => {
    const uc = new CompleteLessonUseCase({ training: fakeTraining({}), progress: null, recognition: null, network: null });
    await assert.rejects(
      uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', answers: IPO_CORRECT }),
      /Watch the video before completing \(0% of 90% watched\)/,
    );
  });

  it('reports the actual watched percent in the rejection', async () => {
    const uc = new CompleteLessonUseCase({
      training: fakeTraining({ 'ipo-1': { percent: 45 } }), progress: null, recognition: null, network: null,
    });
    await assert.rejects(
      uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', answers: IPO_CORRECT }),
      /45% of 90% watched/,
    );
  });

  it('passes the gate at threshold with correct quiz answers', async () => {
    const uc = new CompleteLessonUseCase({
      training: fakeTraining({ 'ipo-1': { percent: 90 } }), progress: null, recognition: null, network: null,
    });
    const res = await uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', answers: IPO_CORRECT });
    assert.equal(res.certified, false);
    assert.equal(res.progress.done, 1);
  });

  it('still enforces the quiz behind the gate', async () => {
    const uc = new CompleteLessonUseCase({
      training: fakeTraining({ 'ipo-1': { percent: 100 } }), progress: null, recognition: null, network: null,
    });
    await assert.rejects(
      uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', answers: [0, 0] }),
      /incorrect/,
    );
  });

  it('non-video lessons skip the gate entirely', async () => {
    const uc = new CompleteLessonUseCase({ training: fakeTraining({}), progress: null, recognition: null, network: null });
    const res = await uc.execute({ partnerId: 'p', courseId: 'qsg', lessonId: 'qsg-1', answers: [1, 0, 0, 0] });
    assert.equal(res.progress.done, 1);
  });
});

describe('RecordWatchUseCase', () => {
  it('records heartbeats for video lessons', async () => {
    const recorded = [];
    const uc = new RecordWatchUseCase({ training: fakeTraining({}, recorded) });
    const res = await uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', percent: 20, seconds: 60 });
    assert.equal(res.percent, 20);
    assert.deepEqual(recorded[0], { partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', percent: 20, seconds: 60 });
  });

  it('rejects a fresh heartbeat jumping past the plausibility cap', async () => {
    const uc = new RecordWatchUseCase({ training: fakeTraining({}) });
    await assert.rejects(
      uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', percent: 80, seconds: 2000 }),
      /jumped too fast/,
    );
  });

  it('rejects percent climbing while seconds stand still', async () => {
    const uc = new RecordWatchUseCase({
      training: fakeTraining({ 'ipo-1': { percent: 20, seconds: 100, updatedAt: new Date().toISOString() } }),
    });
    await assert.rejects(
      uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', percent: 30, seconds: 100 }),
      /inconsistent/,
    );
  });

  it('rejects seconds sprinting beyond elapsed time', async () => {
    const uc = new RecordWatchUseCase({
      training: fakeTraining({ 'ipo-1': { percent: 20, seconds: 100, updatedAt: new Date().toISOString() } }),
    });
    await assert.rejects(
      uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', percent: 30, seconds: 5000 }),
      /jumped too fast/,
    );
  });

  it('accepts gradual genuine heartbeats', async () => {
    const recorded = [];
    const uc = new RecordWatchUseCase({
      training: fakeTraining({ 'ipo-1': { percent: 20, seconds: 100, updatedAt: new Date(Date.now() - 60000).toISOString() } }, recorded),
    });
    const res = await uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'ipo-1', percent: 28, seconds: 150 });
    assert.equal(res.percent, 28);
    assert.equal(recorded.length, 1);
  });

  it('rejects lessons without video', async () => {
    const uc = new RecordWatchUseCase({ training: fakeTraining({}) });
    await assert.rejects(
      uc.execute({ partnerId: 'p', courseId: 'qsg', lessonId: 'qsg-1', percent: 50, seconds: 10 }),
      /no video/,
    );
  });

  it('rejects unknown lessons', async () => {
    const uc = new RecordWatchUseCase({ training: fakeTraining({}) });
    await assert.rejects(
      uc.execute({ partnerId: 'p', courseId: 'ipo', lessonId: 'nope', percent: 50, seconds: 10 }),
      /Unknown lesson/,
    );
  });
});
