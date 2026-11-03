import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { DigestMailer } from '../modules/notifications/infrastructure/DigestMailer.js';
import { buildDigest, isDigestDay, startOfToday, startOfWeek } from '../modules/notifications/domain/Digest.js';

/**
 * Email digest sender (19:00 server-local, daily).
 * Same run handles both cadences: `daily` subscribers every day,
 * `weekly` subscribers on Mondays. Each email covers unread stored
 * items since the last successful send (bounded by the cadence window
 * so a stale stamp can never drag ancient items back in).
 *
 * Skip reasons keep the run quiet by design: no email address,
 * already sent this period, or nothing new. Jobs never throw into
 * the scheduler — failures are counted, not fatal.
 * `runDigestJob` is exported for tests and triggers.
 */

const DAY = 86400000;
const SUBSCRIBER_PAGE = 200;
const ITEM_LIMIT = 50;

export const buildDigestJob = (deps = {}) => {
  const stored = deps.stored ?? new MongoStoredNotificationStore();
  return {
    now: deps.now ?? new Date(),
    partners: deps.partners ?? PartnersModel,
    stored,
    mailer: deps.mailer ?? new DigestMailer(),
    findContacts:
      deps.findContacts
      ?? (async (ids) => PartnersModel.find({ _id: { $in: ids } }).select('email name').lean()),
  };
};

const windowStart = (kind, last, now) => {
  const fallback = new Date(now.getTime() - (kind === 'weekly' ? 7 * DAY : DAY));
  if (!last) return fallback;
  const at = new Date(last);
  return Number.isNaN(at.getTime()) ? fallback : new Date(Math.max(at.getTime(), fallback.getTime()));
};

async function digestSubscriber(job, kind, sub) {
  const periodStart = kind === 'weekly' ? startOfWeek(job.now) : startOfToday(job.now);
  const last = kind === 'weekly' ? sub.lastWeeklyDigestAt : sub.lastDailyDigestAt;
  if (last && new Date(last) >= periodStart) return { status: 'skipped', reason: 'already-sent' };
  const [contact] = await job.findContacts([sub.partnerId]).catch(() => []);
  const email = contact?.email ?? null;
  if (!email) return { status: 'skipped', reason: 'no-email' };
  const items = await job.stored.unreadSince(sub.partnerId, windowStart(kind, last, job.now), ITEM_LIMIT);
  const digest = buildDigest({ kind, items });
  if (!digest) return { status: 'skipped', reason: 'nothing-new' };
  await job.mailer.sendDigest({ to: email, digest });
  await job.stored.stampDigest(sub.partnerId, kind, job.now);
  return { status: 'sent', count: digest.total };
}

export async function runDigestJob(deps = {}) {
  const job = buildDigestJob(deps);
  const started = Date.now();
  const result = {
    at: job.now.toISOString?.() ?? String(job.now),
    checked: 0,
    sent: 0,
    items: 0,
    skipped: { 'no-email': 0, 'already-sent': 0, 'nothing-new': 0 },
    failed: [],
  };
  const kinds = ['daily', ...(isDigestDay('weekly', job.now) ? ['weekly'] : [])];
  try {
    for (const kind of kinds) {
      let cursor = null;
      for (;;) {
        const page = await job.stored.listDigestSubscribers(kind, { cursor, limit: SUBSCRIBER_PAGE });
        if (page.items.length === 0) break;
        for (const sub of page.items) {
          result.checked += 1;
          try {
            const outcome = await digestSubscriber(job, kind, sub);
            if (outcome.status === 'sent') {
              result.sent += 1;
              result.items += outcome.count;
            } else if (outcome.reason in result.skipped) {
              result.skipped[outcome.reason] += 1;
            }
          } catch (error) {
            result.failed.push({ partner: sub.partnerId, error: error?.message ?? String(error) });
          }
        }
        if (!page.hasMore) break;
        cursor = page.items[page.items.length - 1].partnerId;
      }
    }
  } catch (error) {
    console.error('[jobs] digest crashed:', error?.message ?? error);
    result.failed.push({ error: error?.message ?? String(error) });
  }
  console.log(
    `[jobs] digest: ${result.sent}/${result.checked} sent, ${result.items} items `
    + `(no-email ${result.skipped['no-email']}, already-sent ${result.skipped['already-sent']}, `
    + `nothing-new ${result.skipped['nothing-new']}, failed ${result.failed.length}) in ${Date.now() - started}ms`,
  );
  return result;
}
