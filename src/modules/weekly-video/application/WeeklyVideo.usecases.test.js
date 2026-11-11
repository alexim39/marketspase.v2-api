import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateWeeklyVideoUseCase,
  ListWeeklyVideoCommentsUseCase,
  PublishWeeklyVideoUseCase,
  RecordWeeklyVideoHeartbeatUseCase,
  SubmitWeeklyVideoReflectionUseCase,
} from './WeeklyVideo.usecases.js';
import { WeeklyVideoNotifier } from './WeeklyVideo.notifier.js';

const video = (overrides = {}) => ({
  id: '507f1f77bcf86cd799439011',
  weekStart: '2026-11-09',
  weekEnd: '2026-11-16',
  title: 'Lead with clarity',
  description: 'A weekly leadership briefing for the team.',
  youtubeId: '6poBPhfB-WY',
  durationSeconds: 600,
  status: 'draft',
  publishedAt: null,
  createdAt: '2026-11-09T07:00:00.000Z',
  ...overrides,
});

const fakeRepo = (overrides = {}) => ({
  findRawById: async () => video(),
  findById: async () => video({ status: 'published' }),
  findPublishedById: async () => video({ status: 'published' }),
  findByWeek: async () => null,
  create: async (data) => video({ ...data, id: 'new-video' }),
  updateById: async (_id, patch) => video({ ...patch }),
  markScheduled: async (_id, publishAt) => video({ status: 'scheduled', publishAt }),
  claimPublish: async () => video({ status: 'published', publishedAt: new Date().toISOString() }),
  setNotificationResult: async (_id, result) => video({ status: 'published', ...result }),
  getProgress: async () => ({ completed: true }),
  getRawProgress: async () => null,
  startProgress: async () => ({ watchedSeconds: 0, percent: 0, completed: false }),
  updateProgress: async () => ({ watchedSeconds: 10, percent: 1.67, completed: false }),
  getComment: async () => null,
  upsertComment: async ({ body, partnerId }) => ({
    id: 'comment-1',
    videoId: '507f1f77bcf86cd799439011',
    partnerId,
    body,
    status: 'visible',
  }),
  countComments: async () => 2,
  listComments: async () => ({
    rows: [{
      id: 'comment-1',
      videoId: '507f1f77bcf86cd799439011',
      partnerId: '507f1f77bcf86cd799439012',
      body: 'I learned to focus on the next best action.',
      status: 'visible',
    }],
    total: 1,
  }),
  authorLabels: async () => ({
    '507f1f77bcf86cd799439012': { id: '507f1f77bcf86cd799439012', name: 'Ada', username: 'ada' },
  }),
  listPublishedForEngagement: async () => [],
  listProgressForPartner: async () => [],
  notificationRecipients: async () => ({ ids: ['p1', 'p2'], capped: false }),
  listProgressForVideo: async () => ({ rows: [], total: 0, completed: 0 }),
  statsForVideo: async () => ({ started: 0, completed: 0, comments: 0, visibleComments: 0 }),
  findCommentById: async () => ({ id: 'comment-1' }),
  setCommentStatus: async (_id, status) => ({ id: 'comment-1', status }),
  ...overrides,
});

describe('weekly video use cases', () => {
  it('normalises the week and rejects a second video for the same week', async () => {
    const create = new CreateWeeklyVideoUseCase({
      repo: fakeRepo({ findByWeek: async () => video() }),
    });
    await assert.rejects(
      () => create.execute({
        adminId: 'admin',
        input: {
          youtubeUrl: 'https://www.youtube.com/watch?v=6poBPhfB-WY',
          title: 'Lead with clarity',
          description: 'A weekly leadership briefing for the team.',
          weekStart: '2026-11-11',
          durationSeconds: 600,
        },
      }),
      /already exists/,
    );

    let created = null;
    const createOk = new CreateWeeklyVideoUseCase({
      repo: fakeRepo({
        findByWeek: async () => null,
        create: async (data) => {
          created = data;
          return video({ ...data, id: 'created' });
        },
      }),
    });
    const result = await createOk.execute({
      adminId: 'admin',
      input: {
        youtubeUrl: 'https://www.youtube.com/watch?v=6poBPhfB-WY',
        title: 'Lead with clarity',
        description: 'A weekly leadership briefing for the team.',
        weekStart: '2026-11-11',
        durationSeconds: 600,
      },
    });
    assert.equal(result.id, 'created');
    assert.equal(created.weekStart, '2026-11-09');
    assert.equal(created.weekEnd, '2026-11-16');
    assert.equal(created.status, 'draft');
  });

  it('publishes now and notifies once, or schedules a future slot', async () => {
    let report = null;
    const notifier = {
      notify: async () => {
        report = { delivered: 2, failed: 0, capped: false, total: 2 };
        return report;
      },
    };
    const publish = new PublishWeeklyVideoUseCase({
      repo: fakeRepo(),
      notifier,
    });
    const live = await publish.execute({ id: '507f1f77bcf86cd799439011', adminId: 'admin' });
    assert.equal(live.scheduled, false);
    assert.equal(live.notification.delivered, 2);
    assert.equal(report.delivered, 2);

    let scheduledAt = null;
    const scheduled = new PublishWeeklyVideoUseCase({
      repo: fakeRepo({
        markScheduled: async (_id, publishAt) => {
          scheduledAt = publishAt;
          return video({ status: 'scheduled', publishAt });
        },
      }),
      notifier: { notify: async () => ({ delivered: 99 }) },
    });
    const future = await scheduled.execute({
      id: '507f1f77bcf86cd799439011',
      adminId: 'admin',
      publishAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(future.scheduled, true);
    assert.ok(scheduledAt instanceof Date);
  });

  it('credits normal heartbeats and ignores a forward seek', async () => {
    const base = {
      watchedSeconds: 100,
      lastPositionSeconds: 100,
      sessionId: 'session-1234567890',
      lastHeartbeatAt: new Date(Date.now() - 10000),
    };
    let patch = null;
    const useCase = new RecordWeeklyVideoHeartbeatUseCase({
      repo: fakeRepo({
        getRawProgress: async () => base,
        updateProgress: async (_id, _pid, next) => {
          patch = next;
          Object.assign(base, next);
          return { watchedSeconds: next.watchedSeconds, percent: next.percent, completed: false };
        },
      }),
    });
    await useCase.execute({
      partnerId: 'p1',
      id: '507f1f77bcf86cd799439011',
      sessionId: base.sessionId,
      positionSeconds: 110,
      playing: true,
      visible: true,
    });
    assert.equal(patch.watchedSeconds, 110);

    await useCase.execute({
      partnerId: 'p1',
      id: '507f1f77bcf86cd799439011',
      sessionId: base.sessionId,
      positionSeconds: 590,
      playing: true,
      visible: true,
    });
    assert.equal(patch.watchedSeconds, 110);
  });

  it('locks reflections until completion and allows a completed member to post', async () => {
    const locked = new ListWeeklyVideoCommentsUseCase({
      repo: fakeRepo({ getProgress: async () => ({ completed: false }) }),
    });
    const lockedResult = await locked.execute({
      partnerId: 'p1',
      id: '507f1f77bcf86cd799439011',
    });
    assert.equal(lockedResult.unlocked, false);
    assert.equal(lockedResult.items.length, 0);

    const unlocked = new ListWeeklyVideoCommentsUseCase({
      repo: fakeRepo({ getProgress: async () => ({ completed: true }) }),
    });
    const unlockedResult = await unlocked.execute({
      partnerId: 'p1',
      id: '507f1f77bcf86cd799439011',
    });
    assert.equal(unlockedResult.unlocked, true);
    assert.equal(unlockedResult.items[0].author.name, 'Ada');

    const blocked = new SubmitWeeklyVideoReflectionUseCase({
      repo: fakeRepo({ getRawProgress: async () => ({ completedAt: null }) }),
    });
    await assert.rejects(
      () => blocked.execute({
        partnerId: 'p1',
        id: '507f1f77bcf86cd799439011',
        body: 'I learned to focus on the next best action every day.',
      }),
      /Watch at least/,
    );

    const allowed = new SubmitWeeklyVideoReflectionUseCase({
      repo: fakeRepo({ getRawProgress: async () => ({ completedAt: new Date() }) }),
    });
    const result = await allowed.execute({
      partnerId: '507f1f77bcf86cd799439012',
      id: '507f1f77bcf86cd799439011',
      body: 'I learned to focus on the next best action every day.',
    });
    assert.equal(result.comment.body, 'I learned to focus on the next best action every day.');
    assert.equal(result.comment.author.name, 'Ada');
  });

  it('sends one keyed in-app notification per recipient', async () => {
    const calls = [];
    const notifier = new WeeklyVideoNotifier({
      repo: fakeRepo({
        notificationRecipients: async () => ({ ids: ['p1', 'p2'], capped: false }),
      }),
      notify: {
        execute: async (input) => {
          calls.push(input);
          return { id: calls.length };
        },
      },
    });
    const report = await notifier.notify(video({ id: 'video-1', title: 'Lead with clarity' }));
    assert.equal(report.delivered, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].key, 'weekly-video:video-1');
    assert.equal(calls[0].category, 'training');
    assert.equal(calls[0].link, '/dashboard/learn/video-of-the-week');
  });
});
