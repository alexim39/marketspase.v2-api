import {
  MongoWeeklyVideoRepository,
  shapeWeeklyVideo,
} from '../modules/weekly-video/infrastructure/WeeklyVideo.mongo.repository.js';
import { WeeklyVideoNotifier } from '../modules/weekly-video/application/WeeklyVideo.notifier.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';

const HOUR_MS = 60 * 60 * 1000;
const STAGE_1_AFTER_HOURS = 24;
const STAGE_2_AFTER_HOURS = 72;

export const buildWeeklyVideoReminderJob = (deps = {}) => {
  const repo = deps.repo ?? new MongoWeeklyVideoRepository();
  const stored = deps.stored ?? new MongoStoredNotificationStore();
  const notifier = deps.notifier ?? new WeeklyVideoNotifier({
    repo,
    notify: deps.notify ?? new NotifyUseCase({ stored }),
    prefsFor: deps.prefsFor ?? ((partnerIds) => stored.getPreferencesFor(partnerIds)),
  });
  return { repo, notifier };
};

/**
 * Follow-up sweep for the current weekly video.
 *
 * One reminder 24 hours after publish and a final one at 72 hours, both
 * limited to partners who have not reached the verified completion threshold.
 * The repository claim is atomic per video+stage, so parallel dynos cannot
 * double-send. A failed fan-out releases the claim for the next hourly run.
 */
export async function runWeeklyVideoReminderJob({
  repo,
  notifier,
  now = new Date(),
} = {}) {
  const started = Date.now();
  try {
    const deps = repo && notifier ? { repo, notifier } : buildWeeklyVideoReminderJob({ repo, notifier });
    const video = await deps.repo.latestPublishedForReminders(now);
    if (!video) return { checked: 0, stage: null, sent: 0, failed: 0, muted: 0 };

    const publishedAt = new Date(video.publishedAt).getTime();
    if (!Number.isFinite(publishedAt)) {
      return { checked: 0, stage: null, sent: 0, failed: 0, muted: 0 };
    }
    const ageHours = (now.getTime() - publishedAt) / HOUR_MS;
    const stage = ageHours >= STAGE_2_AFTER_HOURS
      ? 2
      : ageHours >= STAGE_1_AFTER_HOURS
        ? 1
        : null;
    if (!stage) {
      return { checked: 0, stage: null, sent: 0, failed: 0, muted: 0 };
    }

    const id = String(video._id ?? video.id);
    const claimed = await deps.repo.claimReminder(id, stage, now);
    if (!claimed) {
      return { checked: 0, stage, sent: 0, failed: 0, muted: 0, alreadySent: true };
    }

    let report;
    try {
      report = await deps.notifier.remind({ video: shapeWeeklyVideo(claimed), stage });
    } catch (error) {
      if (typeof deps.repo.releaseReminder === 'function') {
        await deps.repo.releaseReminder(id, stage).catch(() => null);
      }
      console.error('[jobs] weekly-video reminder fan-out failed:', error?.message ?? error);
      return { checked: 1, stage, sent: 0, failed: 1, muted: 0 };
    }

    if (typeof deps.repo.setReminderResult === 'function') {
      await deps.repo.setReminderResult(id, stage, {
        count: report.delivered,
        failed: report.failed,
        capped: report.capped,
      }).catch(() => null);
    }

    console.log(
      `[jobs] weekly-video-reminder: stage ${stage} sent ${report.delivered}, `
      + `${report.failed} failed, ${report.muted ?? 0} muted, `
      + `${report.skippedCompleted ?? 0} already watched in ${Date.now() - started}ms`,
    );
    return {
      checked: 1,
      stage,
      sent: report.delivered,
      failed: report.failed,
      muted: report.muted ?? 0,
      skippedCompleted: report.skippedCompleted ?? 0,
      capped: report.capped === true,
    };
  } catch (error) {
    console.error('[jobs] weekly-video-reminder crashed:', error?.message ?? error);
    return { checked: 0, stage: null, sent: 0, failed: 1, muted: 0 };
  }
}
