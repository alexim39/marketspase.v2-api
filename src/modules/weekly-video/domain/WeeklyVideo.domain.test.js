import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHeartbeat,
  computeEngagement,
  currentWeekStart,
  normalizeCommentBody,
  normalizeWeekStart,
  weekEndFor,
} from './WeeklyVideo.domain.js';

describe('weekly video domain', () => {
  it('normalises any date to the Monday of its week', () => {
    assert.equal(normalizeWeekStart('2026-11-11'), '2026-11-09');
    assert.equal(normalizeWeekStart('2026-11-09'), '2026-11-09');
    assert.equal(normalizeWeekStart('2026-11-15'), '2026-11-09');
    assert.equal(normalizeWeekStart(new Date('2026-11-11T12:00:00Z')), '2026-11-09');
    assert.equal(weekEndFor('2026-11-09'), '2026-11-16');
    assert.equal(currentWeekStart(new Date('2026-11-11T12:00:00Z')), '2026-11-09');
    assert.equal(currentWeekStart(new Date('2026-11-09T00:30:00+01:00')), '2026-11-09');
  });

  it('credits normal playback but ignores a forward seek', () => {
    const first = applyHeartbeat({
      watchedSeconds: 0,
      lastPositionSeconds: 0,
      durationSeconds: 600,
      lastHeartbeatAt: new Date('2026-11-10T10:00:00Z'),
      now: new Date('2026-11-10T10:00:10Z'),
      positionSeconds: 10,
      playing: true,
      visible: true,
    });
    assert.equal(first.watchedSeconds, 10);
    assert.equal(first.percent, 1.67);

    const skipped = applyHeartbeat({
      watchedSeconds: 10,
      lastPositionSeconds: 10,
      durationSeconds: 600,
      lastHeartbeatAt: new Date('2026-11-10T10:00:10Z'),
      now: new Date('2026-11-10T10:00:20Z'),
      positionSeconds: 500,
      playing: true,
      visible: true,
    });
    assert.equal(skipped.watchedSeconds, 10);
    assert.equal(skipped.credit, 0);
  });

  it('does not credit paused or hidden playback', () => {
    const paused = applyHeartbeat({
      watchedSeconds: 50,
      lastPositionSeconds: 20,
      durationSeconds: 600,
      lastHeartbeatAt: new Date('2026-11-10T10:00:00Z'),
      now: new Date('2026-11-10T10:00:10Z'),
      positionSeconds: 30,
      playing: false,
      visible: true,
    });
    assert.equal(paused.watchedSeconds, 50);
    assert.equal(paused.lastPositionSeconds, 30);

    const hidden = applyHeartbeat({
      watchedSeconds: 50,
      lastPositionSeconds: 30,
      durationSeconds: 600,
      lastHeartbeatAt: new Date('2026-11-10T10:00:10Z'),
      now: new Date('2026-11-10T10:00:20Z'),
      positionSeconds: 40,
      playing: true,
      visible: false,
    });
    assert.equal(hidden.watchedSeconds, 50);
  });

  it('completes at the configured threshold', () => {
    const at89 = applyHeartbeat({
      watchedSeconds: 530,
      lastPositionSeconds: 530,
      durationSeconds: 600,
      lastHeartbeatAt: new Date('2026-11-10T10:00:00Z'),
      now: new Date('2026-11-10T10:00:10Z'),
      positionSeconds: 538,
      playing: true,
      visible: true,
    });
    assert.equal(at89.completed, false);

    const at90 = applyHeartbeat({
      watchedSeconds: 540,
      lastPositionSeconds: 540,
      durationSeconds: 600,
      lastHeartbeatAt: new Date('2026-11-10T10:00:00Z'),
      now: new Date('2026-11-10T10:00:10Z'),
      positionSeconds: 550,
      playing: true,
      visible: true,
    });
    assert.equal(at90.completed, true);
    assert.equal(at90.percent, 91.67);
  });

  it('counts on-time weekly commitments and ignores late catch-up for the streak', () => {
    const videos = [
      {
        id: 'w1',
        weekStart: '2026-10-19',
        publishedAt: '2026-10-19T07:00:00Z',
      },
      {
        id: 'w2',
        weekStart: '2026-10-26',
        publishedAt: '2026-10-26T07:00:00Z',
      },
      {
        id: 'w3',
        weekStart: '2026-11-02',
        publishedAt: '2026-11-02T07:00:00Z',
      },
      {
        id: 'w4',
        weekStart: '2026-11-09',
        publishedAt: '2026-11-09T07:00:00Z',
      },
    ];
    const progress = [
      { videoId: 'w1', completedAt: '2026-10-20T10:00:00Z', reflectionAt: '2026-10-20T10:05:00Z' },
      { videoId: 'w2', completedAt: '2026-10-27T10:00:00Z', reflectionAt: '2026-10-27T10:05:00Z' },
      // Completed after week 4 went live: late catch-up, not a streak repair.
      { videoId: 'w3', completedAt: '2026-11-10T09:00:00Z', reflectionAt: '2026-11-10T09:05:00Z' },
      { videoId: 'w4', completedAt: '2026-11-10T10:00:00Z', reflectionAt: '2026-11-10T10:05:00Z' },
    ];
    const engagement = computeEngagement({
      videos,
      progress,
      now: new Date('2026-11-11T12:00:00Z'),
    });

    assert.equal(engagement.publishedCount, 4);
    assert.equal(engagement.totalCompleted, 4);
    assert.equal(engagement.currentStreak, 1);
    assert.equal(engagement.bestStreak, 2);
    assert.equal(engagement.currentWeekCommitted, true);
    assert.equal(engagement.currentWeekPending, false);
  });

  it('keeps the previous streak visible while the current week is still pending', () => {
    const videos = [
      { id: 'w1', weekStart: '2026-10-26', publishedAt: '2026-10-26T07:00:00Z' },
      { id: 'w2', weekStart: '2026-11-02', publishedAt: '2026-11-02T07:00:00Z' },
      { id: 'w3', weekStart: '2026-11-09', publishedAt: '2026-11-09T07:00:00Z' },
    ];
    const progress = [
      { videoId: 'w1', completedAt: '2026-10-27T10:00:00Z', reflectionAt: '2026-10-27T10:05:00Z' },
      { videoId: 'w2', completedAt: '2026-11-03T10:00:00Z', reflectionAt: '2026-11-03T10:05:00Z' },
    ];
    const engagement = computeEngagement({
      videos,
      progress,
      now: new Date('2026-11-11T12:00:00Z'),
    });

    assert.equal(engagement.currentStreak, 2);
    assert.equal(engagement.currentWeekPending, true);
    assert.equal(engagement.currentWeekCommitted, false);
  });

  it('trims and validates reflection text', () => {
    assert.equal(normalizeCommentBody('  I learned   to focus on the next best action.  '), 'I learned to focus on the next best action.');
    assert.throws(() => normalizeCommentBody('too short'), /20 characters/);
    assert.throws(() => normalizeCommentBody('x'.repeat(1001)), /1000 characters/);
  });
});
