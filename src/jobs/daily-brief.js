import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { MongoProspectRepository } from '../modules/crm/infrastructure/Prospect.mongo.repository.js';
import { buildProspectNotifications } from '../modules/crm/domain/Prospect.notifications.js';
import { buildConversionAlerts } from '../modules/notifications/domain/Feed.items.js';
import { dayKey, pickDailyBrief } from '../modules/notifications/domain/DailyBrief.js';
import { resolvePreferences } from '../modules/notifications/domain/StoredNotifications.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { ListGoalsUseCase } from '../modules/goals/application/Goals.usecases.js';
import { GOAL_EVENTS, goalAtRiskPayload, goalCompletedPayload } from '../modules/goals/domain/GoalEvents.js';
import { weekKey } from '../modules/notifications/domain/WeeklyReview.js';
import { domainEvents } from '../shared/events/DomainEvents.js';
import { MongoGoalStore } from '../modules/goals/infrastructure/Goals.mongo.repository.js';
import { MongoOrderReader } from '../modules/billing/infrastructure/Billing.mongo.repository.js';
import { MongoNetworkRepository } from '../modules/network/infrastructure/Network.mongo.repository.js';
import { MongoProgressionStore } from '../modules/progression/infrastructure/Progression.mongo.repository.js';
import { briefFocus, dailyEligibility } from '../modules/progression/domain/DailyBrief.eligibility.js';
import { backfillDobParts } from './backfill-dob.js';

/**
 * Daily priorities brief (06:30 server-local).
 * Per active partner: ≤3 priority items (overdue follow-ups, at-risk goals)
 * + 1 momentum item (deadline-aware praise or latest conversion), fanned
 * out as keyed stored notifications.
 *
 * Cost control: cursor pages over active partners; one prospects read
 * (500 cap, same as a Center view), one goals read with live numerators,
 * one progress-doc read, one prefs read per partner. Releases/mentions
 * stay derived-only so the brief never duplicates the live feed.
 * Jobs never throw into the scheduler — failures are counted, not fatal.
 * `runDailyBriefJob` is exported for tests and triggers.
 */

const PARTNER_PAGE = 200;
const PROSPECT_LIMIT = 500;
const AT_RISK_DAYS = 7;
const PRAISE_DAYS = 7;
const PRAISE_MIN_PERCENT = 70;

const asFollowup = (n) => ({
  category: 'daily',
  priority: n.urgency === true ? 'high' : 'medium',
  title: String(n.title ?? 'Follow up'),
  body: String(n.description ?? n.tag ?? 'Follow-up due'),
  icon: n.icon ?? 'call',
  link: `/dashboard/prospects/detail/${n.prospectId}`,
});

const asGoalRisk = (g) => ({
  category: 'goals',
  priority: 'high',
  title: `Goal at risk: ${g.title}`,
  body: `${g.progress.remaining} to go · ${g.progress.daysLeft}d left · needs ~${g.progress.forecast.requiredDaily ?? '?'} per day`,
  icon: 'flag',
  link: '/dashboard/goals',
});

const asGoalPraise = (g) => ({
  category: 'goals',
  priority: 'low',
  title: `${g.progress.daysLeft}d left — ${g.progress.percent}% there`,
  body: `${g.title}: ${g.progress.remaining} to go. Finish strong.`,
  icon: 'celebration',
  link: '/dashboard/goals',
});

const TRAINING_DUE_KEYS = [
  ['ipo', 'IPO'],
  ['qsg', 'QSG'],
  ['smo', 'SMO'],
];

const asTrainingDue = (label) => ({
  category: 'training',
  priority: 'high',
  title: `${label} needs confirmation`,
  body: 'You marked it done — nudge your upline to confirm so your journey unblocks.',
  icon: 'school',
  link: '/dashboard/training',
});

const asConversionPraise = (c) => ({
  category: 'recognition',
  priority: 'low',
  title: c.title,
  body: `${c.body} Keep the momentum.`,
  icon: 'emoji_events',
  link: c.link ?? '/dashboard/prospects/pipeline',
});

export const buildDailyBriefJob = (deps = {}) => {
  const prospects = deps.prospects ?? new MongoProspectRepository();
  const stored = deps.stored ?? new MongoStoredNotificationStore();
  const goals = new ListGoalsUseCase({
    goals: deps.goalStore ?? new MongoGoalStore(),
    orders: deps.orders ?? new MongoOrderReader(),
    prospects: deps.goalProspects ?? prospects,
    network: deps.network ?? new MongoNetworkRepository(),
  });
  return {
    day: deps.day ?? dayKey(deps.now ?? new Date()),
    now: deps.now ?? new Date(),
    partners: deps.partners ?? PartnersModel,
    prospects,
    findProspects:
      deps.findProspects ?? ((partnerId) => prospects.findByPartnerId(partnerId, { limit: PROSPECT_LIMIT, skip: 0 })),
    listGoals: deps.listGoals ?? ((partnerId, now) => goals.execute({ partnerId, now })),
    findLevel: deps.findLevel ?? ((partnerId) => new MongoProgressionStore().findByPartner(partnerId)),
    stored,
    notify: deps.notify ?? new NotifyUseCase({ stored }),
    backfill: deps.backfill ?? backfillDobParts,
    events: deps.events ?? domainEvents,
  };
};

/** Active, incomplete goals whose window still covers now (shared with the weekly review). */
export const activeGoalRows = (goals, now) => (goals ?? []).filter((g) => {
  if (!g?.progress || g.progress.complete) return false;
  if (g.status === 'closed') return false;
  return new Date(g.endDate).getTime() >= new Date(now).getTime() - 86400000;
});

async function briefPartner(job, partnerId) {
  const [prefs, alreadySent] = await Promise.all([
    job.stored.getPreferences(partnerId).catch(() => null),
    job.stored.hasBriefForDay(partnerId, job.day).catch(() => false),
  ]);
  if (alreadySent) return { status: 'skipped', reason: 'already-sent' };
  const dailyOptIn = resolvePreferences(prefs).channels.daily.inApp !== false;

  const [{ items: prospectList }, goalRows, progressDoc] = await Promise.all([
    job.findProspects(partnerId).catch(() => ({ items: [] })),
    job.listGoals(partnerId, job.now).catch(() => []),
    job.findLevel(partnerId).catch(() => null),
  ]);
  const list = prospectList ?? [];
  const followups = buildProspectNotifications(list, job.now)
    .sort((a, b) => Number(b.urgency === true) - Number(a.urgency === true))
    .slice(0, 5)
    .map(asFollowup);
  const active = activeGoalRows(goalRows, job.now);
  const atRiskGoals = active
    .filter((g) => !g.progress.onTrack && g.progress.daysLeft <= AT_RISK_DAYS)
    .sort((a, b) => a.progress.daysLeft - b.progress.daysLeft);
  // Lifecycle moments ride the bus (member already covered by the brief
  // items below; the fan-out notifies the upline + celebrates completions).
  // Best-effort per goal — a bad payload never breaks the brief.
  const week = weekKey(job.now);
  for (const g of atRiskGoals.filter((x) => x?.id)) {
    try {
      await job.events.emit(GOAL_EVENTS.AT_RISK, goalAtRiskPayload({
        partnerId,
        goalId: g.id,
        title: g.title,
        remaining: g.progress.remaining,
        daysLeft: g.progress.daysLeft,
        requiredDaily: g.progress.forecast?.requiredDaily,
        week,
      }));
    } catch { /* goal events never break the brief */ }
  }
  for (const g of (goalRows ?? []).filter((x) => x?.id && x?.progress?.complete
    && new Date(x.endDate).getTime() >= new Date(job.now).getTime() - 14 * 86400000)) {
    try {
      await job.events.emit(GOAL_EVENTS.COMPLETED, goalCompletedPayload({
        partnerId,
        goalId: g.id,
        title: g.title,
      }));
    } catch { /* goal events never break the brief */ }
  }
  const goalNudges = atRiskGoals.slice(0, 3).map(asGoalRisk);
  const trainingDue = TRAINING_DUE_KEYS.filter(([key]) => {
    const s = progressDoc?.[key];
    return s?.done === true && !s?.confirmedAt;
  }).slice(0, 2).map(([, label]) => asTrainingDue(label));
  const praiseGoal = active
    .filter((g) => g.progress.percent >= PRAISE_MIN_PERCENT && g.progress.daysLeft <= PRAISE_DAYS)
    .sort((a, b) => b.progress.percent - a.progress.percent)[0];
  const conversions = buildConversionAlerts(list, { now: job.now });
  const momentum = praiseGoal ? asGoalPraise(praiseGoal) : conversions.length > 0 ? asConversionPraise(conversions[0]) : null;

  const candidateCount = followups.length + goalNudges.length + trainingDue.length + (momentum ? 1 : 0);
  const { eligible, reason } = dailyEligibility({
    level: progressDoc?.level ?? 'partner',
    candidateCount,
    dailyOptIn,
  });
  if (!eligible) return { status: 'skipped', reason };
  const items = pickDailyBrief({
    followups,
    goalNudges,
    trainingDue,
    momentum,
    focus: briefFocus(progressDoc?.level ?? 'partner'),
    day: job.day,
  });
  let sent = 0;
  for (const item of items) {
    await job.notify.execute({ recipientId: partnerId, ...item });
    sent += 1;
  }
  return { status: 'briefed', sent };
}

export async function runDailyBriefJob(deps = {}) {
  const job = buildDailyBriefJob(deps);
  const started = Date.now();
  const result = {
    day: job.day,
    checked: 0,
    briefed: 0,
    sent: 0,
    skipped: { 'opted-out': 0, 'nothing-actionable': 0, 'already-sent': 0 },
    failed: [],
    backfill: null,
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
          const outcome = await briefPartner(job, partnerId);
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
    console.error('[jobs] daily-brief crashed:', error?.message ?? error);
    result.failed.push({ error: error?.message ?? String(error) });
  }
  try {
    // Auto-backfill: stamp derived birthday parts for docs that missed the
    // hooks (imports, legacy writes). Idempotent; invalid dates are counted
    // and rescanned next run, never mailed on.
    result.backfill = await job.backfill();
  } catch (error) {
    console.error('[jobs] daily-brief backfill failed:', error?.message ?? error);
  }
  console.log(
    `[jobs] daily-brief ${job.day}: ${result.briefed}/${result.checked} briefed, ${result.sent} sent `
    + `(opted-out ${result.skipped['opted-out']}, nothing-actionable ${result.skipped['nothing-actionable']}, `
    + `already-sent ${result.skipped['already-sent']}, failed ${result.failed.length}) in ${Date.now() - started}ms`,
  );
  return result;
}
