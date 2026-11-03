import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { MongoProspectRepository } from '../modules/crm/infrastructure/Prospect.mongo.repository.js';
import { buildProspectNotifications } from '../modules/crm/domain/Prospect.notifications.js';
import { resolvePreferences } from '../modules/notifications/domain/StoredNotifications.js';
import { buildLeaderPrompt, buildPersonalPrompt, weekKey } from '../modules/notifications/domain/WeeklyReview.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { ListGoalsUseCase } from '../modules/goals/application/Goals.usecases.js';
import { MongoGoalStore } from '../modules/goals/infrastructure/Goals.mongo.repository.js';
import { MongoOrderReader } from '../modules/billing/infrastructure/Billing.mongo.repository.js';
import { MongoNetworkRepository } from '../modules/network/infrastructure/Network.mongo.repository.js';
import { activeGoalRows } from './daily-brief.js';

/**
 * Weekly review request (Monday 07:00 server-local).
 * One keyed stored notification per active partner: leaders (anyone with
 * direct reports) get a downline-review prompt; everyone else gets a
 * personal week-review prompt with live follow-up + goal counts.
 *
 * Cost control: cursor pages over active partners; leaders need a single
 * child-count read, builders one prospects read + one goals read. Reruns
 * in the same ISO week are no-ops (`findByKey` + unique key backstop).
 * Jobs never throw into the scheduler — failures are counted, not fatal.
 * `runWeeklyReviewJob` is exported for tests and triggers.
 */

const PARTNER_PAGE = 200;
const PROSPECT_LIMIT = 500;

export const buildWeeklyReviewJob = (deps = {}) => {
  const prospects = deps.prospects ?? new MongoProspectRepository();
  const stored = deps.stored ?? new MongoStoredNotificationStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const goals = new ListGoalsUseCase({
    goals: deps.goalStore ?? new MongoGoalStore(),
    orders: deps.orders ?? new MongoOrderReader(),
    prospects: deps.goalProspects ?? prospects,
    network: deps.goalNetwork ?? network,
  });
  return {
    week: deps.week ?? weekKey(deps.now ?? new Date()),
    now: deps.now ?? new Date(),
    partners: deps.partners ?? PartnersModel,
    network,
    countChildren: deps.countChildren ?? ((partnerId) => network.countChildren(partnerId)),
    findProspects:
      deps.findProspects ?? ((partnerId) => prospects.findByPartnerId(partnerId, { limit: PROSPECT_LIMIT, skip: 0 })),
    listGoals: deps.listGoals ?? ((partnerId, now) => goals.execute({ partnerId, now })),
    stored,
    notify: deps.notify ?? new NotifyUseCase({ stored }),
  };
};

async function reviewPartner(job, partnerId) {
  const prefs = await job.stored.getPreferences(partnerId).catch(() => null);
  const channels = resolvePreferences(prefs).channels;
  const directReports = await job.countChildren(partnerId).catch(() => 0);

  if (directReports > 0) {
    if (channels.team.inApp === false) return { status: 'skipped', reason: 'opted-out' };
    const item = buildLeaderPrompt({ week: job.week, directReports });
    if (await job.stored.findByKey(partnerId, item.key).catch(() => null)) {
      return { status: 'skipped', reason: 'already-sent' };
    }
    await job.notify.execute({ recipientId: partnerId, ...item });
    return { status: 'briefed', sent: 1 };
  }

  if (channels.goals.inApp === false) return { status: 'skipped', reason: 'opted-out' };
  const [{ items: prospectList }, goalRows] = await Promise.all([
    job.findProspects(partnerId).catch(() => ({ items: [] })),
    job.listGoals(partnerId, job.now).catch(() => []),
  ]);
  const active = activeGoalRows(goalRows, job.now);
  const openFollowups = buildProspectNotifications(prospectList ?? [], job.now).length;
  if (openFollowups === 0 && active.length === 0) return { status: 'skipped', reason: 'nothing-actionable' };
  const item = buildPersonalPrompt({
    week: job.week,
    openFollowups,
    activeGoals: active.length,
    atRiskGoals: active.filter((g) => !g.progress.onTrack).length,
  });
  if (await job.stored.findByKey(partnerId, item.key).catch(() => null)) {
    return { status: 'skipped', reason: 'already-sent' };
  }
  await job.notify.execute({ recipientId: partnerId, ...item });
  return { status: 'briefed', sent: 1 };
}

export async function runWeeklyReviewJob(deps = {}) {
  const job = buildWeeklyReviewJob(deps);
  const started = Date.now();
  const result = {
    week: job.week,
    checked: 0,
    briefed: 0,
    sent: 0,
    skipped: { 'opted-out': 0, 'nothing-actionable': 0, 'already-sent': 0 },
    failed: [],
  };
  try {
    let cursor = null;
    for (;;) {
      const filter = { status: true };
      if (cursor) filter._id = { $gt: cursor };
      const page = await job.partners.find(filter).select('_id').sort({ _id: 1 }).limit(PARTNER_PAGE).lean();
      if (page.length === 0) break;
      for (const doc of page) {
        const partnerId = String(doc._id);
        result.checked += 1;
        try {
          const outcome = await reviewPartner(job, partnerId);
          if (outcome.status === 'briefed') {
            result.briefed += 1;
            result.sent += outcome.sent;
          } else if (outcome.reason in result.skipped) {
            result.skipped[outcome.reason] += 1;
          }
        } catch (error) {
          result.failed.push({ partner: partnerId, error: error?.message ?? String(error) });
        }
      }
      cursor = page[page.length - 1]._id;
    }
  } catch (error) {
    console.error('[jobs] weekly-review crashed:', error?.message ?? error);
    result.failed.push({ error: error?.message ?? String(error) });
  }
  console.log(
    `[jobs] weekly-review ${job.week}: ${result.briefed}/${result.checked} briefed, ${result.sent} sent `
    + `(opted-out ${result.skipped['opted-out']}, nothing-actionable ${result.skipped['nothing-actionable']}, `
    + `already-sent ${result.skipped['already-sent']}, failed ${result.failed.length}) in ${Date.now() - started}ms`,
  );
  return result;
}
