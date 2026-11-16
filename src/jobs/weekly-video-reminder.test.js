import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runWeeklyVideoReminderJob } from './weekly-video-reminder.js';

const now = new Date('2026-11-12T10:00:00.000Z');
const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);

const videoRow = (publishedAt) => ({
  _id: 'vid-1',
  weekStart: '2026-11-09',
  weekEnd: '2026-11-16',
  title: 'Lead with clarity',
  publishedAt,
  reminder1At: null,
  reminder2At: null,
});

describe('weekly video reminder job', () => {
  it('sends the 24-hour follow-up to non-watchers and records the result', async () => {
    const publishedAt = hoursAgo(25);
    let claimedStage = null;
    let saved = null;
    const repo = {
      latestPublishedForReminders: async () => videoRow(publishedAt),
      claimReminder: async (_id, stage, at) => {
        claimedStage = stage;
        return { ...videoRow(publishedAt), reminder1At: at };
      },
      setReminderResult: async (_id, stage, result) => {
        saved = { stage, ...result };
        return {};
      },
      releaseReminder: async () => assert.fail('should not release'),
    };
    const notifier = {
      remind: async ({ stage }) => {
        assert.equal(stage, 1);
        return { delivered: 4, failed: 1, muted: 1, skippedCompleted: 2, capped: false };
      },
    };
    const result = await runWeeklyVideoReminderJob({ repo, notifier, now });
    assert.equal(result.stage, 1);
    assert.equal(result.sent, 4);
    assert.equal(claimedStage, 1);
    assert.deepEqual(saved, { stage: 1, count: 4, failed: 1, capped: false });
  });

  it('sends the final follow-up at 72 hours', async () => {
    const publishedAt = hoursAgo(73);
    let claimedStage = null;
    const repo = {
      latestPublishedForReminders: async () => videoRow(publishedAt),
      claimReminder: async (_id, stage, at) => {
        claimedStage = stage;
        return { ...videoRow(publishedAt), reminder2At: at };
      },
      setReminderResult: async () => ({}),
      releaseReminder: async () => assert.fail('should not release'),
    };
    const notifier = {
      remind: async ({ stage }) => {
        assert.equal(stage, 2);
        return { delivered: 2, failed: 0, muted: 0, skippedCompleted: 5, capped: false };
      },
    };
    const result = await runWeeklyVideoReminderJob({ repo, notifier, now });
    assert.equal(result.stage, 2);
    assert.equal(result.sent, 2);
    assert.equal(claimedStage, 2);
  });

  it('does nothing before the 24-hour mark', async () => {
    const repo = {
      latestPublishedForReminders: async () => videoRow(hoursAgo(5)),
      claimReminder: async () => assert.fail('should not claim'),
      setReminderResult: async () => assert.fail('should not save'),
      releaseReminder: async () => assert.fail('should not release'),
    };
    const result = await runWeeklyVideoReminderJob({
      repo,
      notifier: { remind: async () => assert.fail('should not notify') },
      now,
    });
    assert.equal(result.stage, null);
    assert.equal(result.sent, 0);
  });

  it('skips a stage that was already claimed by another run', async () => {
    const repo = {
      latestPublishedForReminders: async () => videoRow(hoursAgo(25)),
      claimReminder: async () => null,
      setReminderResult: async () => assert.fail('should not save'),
      releaseReminder: async () => assert.fail('should not release'),
    };
    const result = await runWeeklyVideoReminderJob({
      repo,
      notifier: { remind: async () => assert.fail('should not notify') },
      now,
    });
    assert.equal(result.alreadySent, true);
  });

  it('releases the claim when fan-out fails so the next run retries', async () => {
    let released = null;
    const repo = {
      latestPublishedForReminders: async () => videoRow(hoursAgo(25)),
      claimReminder: async (_id, stage, at) => ({ ...videoRow(hoursAgo(25)), reminder1At: at }),
      setReminderResult: async () => assert.fail('should not save a failed fan-out'),
      releaseReminder: async (_id, stage) => {
        released = stage;
        return {};
      },
    };
    const result = await runWeeklyVideoReminderJob({
      repo,
      notifier: { remind: async () => { throw new Error('notification store down'); } },
      now,
    });
    assert.equal(result.failed, 1);
    assert.equal(released, 1);
  });
});
