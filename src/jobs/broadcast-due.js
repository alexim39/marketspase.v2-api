import { RunBroadcastDueUseCase } from '../modules/broadcast/application/Broadcast.campaign.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { buildSmsSender } from '../modules/notifications/infrastructure/SmsSender.js';
import { sendEmail } from '../services/emailService.js';
import { env } from '../shared/config/env.js';

/**
 * Scheduled broadcast firer (every minute, server-local).
 * Claims due campaign rows and fans out per channel with the same
 * atomic-claim pattern as the outreach worker — parallel dynos never
 * double-blast. Jobs never throw into the scheduler.
 * `runBroadcastDueJob` is exported for tests and triggers.
 */
export const buildBroadcastDueJob = (deps = {}) => {
  const stored = deps.stored ?? new MongoStoredNotificationStore();
  return new RunBroadcastDueUseCase({
    notify: deps.notify ?? new NotifyUseCase({ stored }),
    mail: deps.mail ?? sendEmail,
    sms: deps.sms ?? buildSmsSender(deps.smsEnv ?? env.sms),
  });
};

export async function runBroadcastDueJob(deps = {}) {
  const started = Date.now();
  try {
    const result = await buildBroadcastDueJob(deps).execute({});
    if (result.checked > 0) {
      console.log(
        `[jobs] broadcast-due: ${result.sent}/${result.checked} fired `
        + `(failed ${result.failed.length}) in ${Date.now() - started}ms`,
      );
    }
    return result;
  } catch (error) {
    console.error('[jobs] broadcast-due crashed:', error?.message ?? error);
    return { checked: 0, sent: 0, failed: [{ error: error?.message ?? String(error) }] };
  }
}
