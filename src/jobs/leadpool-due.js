import { ExpireStaleClaimsUseCase } from '../modules/crm/application/Prospect.expiry.js';
import { ReleaseProspectToPoolUseCase } from '../modules/crm/application/Prospect.release.js';
import { MongoProspectRepository } from '../modules/crm/infrastructure/Prospect.mongo.repository.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { sendEmail } from '../services/emailService.js';

/**
 * Buy Prospect work-or-return sweep (every 15 minutes, server-local).
 * Warns holders inside the warning window, auto-returns idle claims past
 * the deadline (standard return refund applies). Jobs never throw into
 * the scheduler — per-row outcomes carry the errors.
 * `runLeadPoolDueJob` is exported for tests and triggers.
 */
export const buildLeadPoolDueJob = (deps = {}) => {
  const stored = deps.stored ?? new MongoStoredNotificationStore();
  const notifyCenter = deps.notifyCenter ?? new NotifyUseCase({ stored });
  const notifyHolder = async ({ kind, partnerId, prospectId, leadName, hoursLeft }) => {
    const warning = kind === 'warning';
    const title = warning ? `Lead expires in ${hoursLeft}h` : 'Lead returned to the pool';
    const body = warning
      ? `${leadName} goes back to Buy Prospect in ${hoursLeft}h unless you log activity — call, message, book or move them.`
      : `${leadName} had no activity for 48h and is back in Buy Prospect for others to claim.`;
    try {
      await notifyCenter.execute({
        recipientId: String(partnerId),
        category: 'system',
        priority: 'high',
        title,
        body,
        icon: 'hourglass_bottom',
        link: '/dashboard/prospects/pipeline',
        key: `leadpool:${kind}:${String(prospectId)}`,
      });
    } catch { /* in-app is best-effort here */ }
    try {
      const member = await PartnersModel.findById(partnerId).select('email').lean();
      if (member?.email) await sendEmail(member.email, title, `<p>${body}</p>`);
    } catch { /* email is best-effort here */ }
  };
  return new ExpireStaleClaimsUseCase({
    claims: deps.claims,
    release: deps.release ?? new ReleaseProspectToPoolUseCase({ prospects: new MongoProspectRepository() }),
    notify: deps.notify ?? notifyHolder,
  });
};

export async function runLeadPoolDueJob(deps = {}) {
  const started = Date.now();
  try {
    const result = await buildLeadPoolDueJob(deps).execute({});
    if (result.checked > 0 || result.failed.length > 0) {
      console.log(
        `[jobs] leadpool-due: warned ${result.warned}, expired ${result.expired} `
        + `of ${result.checked} (failed ${result.failed.length}) in ${Date.now() - started}ms`,
      );
    }
    return result;
  } catch (error) {
    console.error('[jobs] leadpool-due crashed:', error?.message ?? error);
    return { checked: 0, warned: 0, expired: 0, secured: 0, failed: [{ error: error?.message ?? String(error) }] };
  }
}
