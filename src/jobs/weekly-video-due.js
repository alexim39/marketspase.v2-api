import { MongoWeeklyVideoRepository } from '../modules/weekly-video/infrastructure/WeeklyVideo.mongo.repository.js';
import { WeeklyVideoNotifier } from '../modules/weekly-video/application/WeeklyVideo.notifier.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';

export const buildWeeklyVideoDueJob = (deps = {}) => {
  const repo = deps.repo ?? new MongoWeeklyVideoRepository();
  const notifier = deps.notifier ?? new WeeklyVideoNotifier({
    repo,
    notify: deps.notify ?? new NotifyUseCase({
      stored: deps.stored ?? new MongoStoredNotificationStore(),
    }),
  });
  return { repo, notifier };
};

/**
 * Publish any scheduled weekly videos whose Monday slot is due and send the
 * one-time in-app notification. The repository claim is atomic, so parallel
 * dynos cannot publish/notify the same video twice.
 */
export async function runWeeklyVideoDueJob({ repo, notifier, now = new Date(), limit = 10 } = {}) {
  const started = Date.now();
  try {
    const deps = repo && notifier ? { repo, notifier } : buildWeeklyVideoDueJob({ repo, notifier });
    const due = await deps.repo.listScheduledDue(now, limit);
    let published = 0;
    let notified = 0;
    let failed = 0;
    for (const row of due) {
      const id = String(row._id);
      const claimed = await deps.repo.claimPublish(id, now);
      if (!claimed) continue;
      published += 1;
      try {
        const report = await deps.notifier.notify(claimed);
        await deps.repo.setNotificationResult(id, {
          notifiedAt: report.delivered > 0 ? now : null,
          count: report.delivered,
          failed: report.failed,
          capped: report.capped,
        });
        notified += report.delivered;
        failed += report.failed;
      } catch (error) {
        failed += 1;
        console.error('[jobs] weekly-video notify failed:', error?.message ?? error);
        await deps.repo.setNotificationResult(id, {
          notifiedAt: null,
          count: 0,
          failed: 1,
          capped: false,
        }).catch(() => null);
      }
    }
    console.log(
      `[jobs] weekly-video-due: ${published}/${due.length} published, ${notified} notified, ${failed} failed in ${Date.now() - started}ms`,
    );
    return { checked: due.length, published, notified, failed };
  } catch (error) {
    console.error('[jobs] weekly-video-due crashed:', error?.message ?? error);
    return { checked: 0, published: 0, notified: 0, failed: 1 };
  }
}
