import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runWeeklyVideoDueJob } from './weekly-video-due.js';

describe('weekly video due job', () => {
  it('publishes due videos and records the notification result', async () => {
    let saved = null;
    let claimed = 0;
    const repo = {
      listScheduledDue: async () => [{ _id: 'v1' }],
      claimPublish: async () => {
        claimed += 1;
        return { id: 'v1', title: 'Lead with clarity' };
      },
      setNotificationResult: async (_id, result) => {
        saved = result;
        return result;
      },
    };
    const notifier = {
      notify: async () => ({ delivered: 3, failed: 1, capped: false, total: 4 }),
    };
    const result = await runWeeklyVideoDueJob({ repo, notifier, now: new Date('2026-11-09T07:00:00Z') });
    assert.equal(result.checked, 1);
    assert.equal(result.published, 1);
    assert.equal(result.notified, 3);
    assert.equal(result.failed, 1);
    assert.equal(claimed, 1);
    assert.equal(saved.count, 3);
    assert.equal(saved.failed, 1);
    assert.ok(saved.notifiedAt instanceof Date);
  });

  it('does nothing when no scheduled video is due', async () => {
    const result = await runWeeklyVideoDueJob({
      repo: {
        listScheduledDue: async () => [],
        claimPublish: async () => assert.fail('should not claim'),
        setNotificationResult: async () => assert.fail('should not save'),
      },
      notifier: { notify: async () => assert.fail('should not notify') },
    });
    assert.deepEqual(result, { checked: 0, published: 0, notified: 0, failed: 0 });
  });
});
