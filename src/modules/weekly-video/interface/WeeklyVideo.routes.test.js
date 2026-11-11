import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  buildAdminWeeklyVideoRouter,
  buildWeeklyVideoRouter,
} from './WeeklyVideo.routes.js';

const VIDEO_ID = '507f1f77bcf86cd799439011';
const PARTNER_ID = '507f1f77bcf86cd799439012';
const video = {
  id: VIDEO_ID,
  weekStart: '2026-11-09',
  weekEnd: '2026-11-16',
  weekLabel: '9 Nov 2026 – 15 Nov 2026',
  title: 'Lead with clarity',
  description: 'A weekly leadership briefing for the team.',
  youtubeId: '6poBPhfB-WY',
  thumbnailUrl: 'https://i.ytimg.com/vi/6poBPhfB-WY/hqdefault.jpg',
  durationSeconds: 600,
  status: 'published',
  publishedAt: '2026-11-09T07:00:00.000Z',
  createdAt: '2026-11-09T06:00:00.000Z',
  updatedAt: '2026-11-09T07:00:00.000Z',
};
const progress = {
  id: 'p1',
  videoId: VIDEO_ID,
  partnerId: PARTNER_ID,
  watchedSeconds: 0,
  lastPositionSeconds: 0,
  durationSeconds: 600,
  percent: 0,
  completed: false,
  completedAt: null,
  reflectionAt: null,
  startedAt: '2026-11-10T10:00:00.000Z',
  lastHeartbeatAt: '2026-11-10T10:00:00.000Z',
  heartbeatCount: 0,
};

const repo = (overrides = {}) => ({
  currentPublished: async () => video,
  listPublished: async () => [video],
  findPublishedById: async () => video,
  findById: async () => ({ ...video, status: 'draft' }),
  findRawById: async () => ({ ...video, status: 'draft' }),
  findByWeek: async () => null,
  create: async (data) => ({ ...video, ...data, id: VIDEO_ID }),
  listAdmin: async () => ({ items: [video], total: 1 }),
  getProgress: async () => progress,
  getComment: async () => null,
  countComments: async () => 0,
  listComments: async () => ({ rows: [], total: 0 }),
  listPublishedForEngagement: async () => [],
  listProgressForPartner: async () => [],
  startProgress: async () => progress,
  listProgressForVideo: async () => ({ rows: [], total: 0, completed: 0 }),
  statsForVideo: async () => ({ started: 0, completed: 0, comments: 0, visibleComments: 0 }),
  authorLabels: async () => ({}),
  ...overrides,
});

const auth = (req, _res, next) => {
  req.auth = { partnerId: PARTNER_ID };
  next();
};

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/weekly-videos', buildWeeklyVideoRouter({ repo: repo(), auth }));
  app.use('/v1/admin/weekly-videos', buildAdminWeeklyVideoRouter({
    repo: repo(),
    auth,
    admin: (_req, _res, next) => next(),
    audit: async () => null,
    notifier: { notify: async () => ({ delivered: 0, failed: 0, capped: false, total: 0 }) },
  }));
  app.use((err, _req, res, _next) => {
    res.status(err?.statusCode || 400).json({ message: err?.message ?? 'Invalid request', success: false });
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('weekly video routes', () => {
  it('serves the current video and starts a watch session', async () => {
    const current = await fetch(`${base}/v1/weekly-videos/current`);
    assert.equal(current.status, 200);
    const currentBody = await current.json();
    assert.equal(currentBody.data.video.title, 'Lead with clarity');

    const start = await fetch(`${base}/v1/weekly-videos/${VIDEO_ID}/watch/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(start.status, 200);
    const startBody = await start.json();
    assert.ok(startBody.data.sessionId);
  });

  it('locks comments until the member completes the watch', async () => {
    const response = await fetch(`${base}/v1/weekly-videos/${VIDEO_ID}/comments`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.unlocked, false);
    assert.equal(body.data.items.length, 0);
  });

  it('validates admin creation and lists admin rows', async () => {
    const list = await fetch(`${base}/v1/admin/weekly-videos`);
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(listBody.data.items.length, 1);

    const bad = await fetch(`${base}/v1/admin/weekly-videos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        youtubeUrl: 'https://example.com/not-youtube',
        title: 'Lead with clarity',
        description: 'A weekly leadership briefing for the team.',
        weekStart: '2026-11-09',
        durationSeconds: 600,
      }),
    });
    assert.equal(bad.status, 400);
  });
});
