import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { buildDormantNudge } from '../modules/notifications/infrastructure/LifecycleMailer.js';
import { sendEmail } from '../services/emailService.js';

/**
 * Dormant-nudge email (09:00 server-local, daily).
 * Partners silent for DORMANT_NUDGE_DAYS (default 3) — including accounts
 * created that long ago that never signed in — get one "we miss you" mail.
 * One-time per account: the dormantNudgeAt stamp is the guard, written
 * atomically (null-check in the filter) so parallel dynos never double-send.
 *
 * Skip reasons keep the run quiet by design: suspended, no email, already
 * nudged, or recently active. Jobs never throw into the scheduler —
 * failures are counted, not fatal.
 * `runDormantNudgeJob` is exported for tests and triggers.
 */

const DAY = 86400000;
const PARTNER_PAGE = 200;

export const dormantDays = () => {
  const n = Number(process.env.DORMANT_NUDGE_DAYS ?? 3);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
};

export const buildDormantNudgeJob = (deps = {}) => ({
  now: deps.now ?? new Date(),
  days: deps.days ?? dormantDays(),
  partners: deps.partners ?? PartnersModel,
  send: deps.send ?? sendEmail,
});

const daysAway = (row, now) => {
  const ref = row.lastLoginAt ?? row.createdAt ?? now;
  const ms = Number(new Date(now).getTime()) - Number(new Date(ref).getTime());
  return Math.max(1, Math.floor(ms / DAY));
};

async function nudgeCandidate(job, row) {
  const email = String(row.email ?? '').trim();
  if (!email) return { status: 'skipped', reason: 'no-email' };
  if (row.suspendedAt) return { status: 'skipped', reason: 'suspended' };
  if (row.dormantNudgeAt) return { status: 'skipped', reason: 'already-sent' };
  // Second line of defence behind the query filter: only the truly silent.
  const cutoff = new Date(job.now.getTime() - job.days * DAY);
  const lastSeen = row.lastLoginAt ? new Date(row.lastLoginAt) : null;
  const since = row.lastLoginAt ? lastSeen : (row.createdAt ? new Date(row.createdAt) : null);
  if (since && since >= cutoff) return { status: 'skipped', reason: 'recent' };
  const name = `${row.name ?? ''} ${row.surname ?? ''}`.trim() || row.username || 'Partner';
  const mail = buildDormantNudge({ memberName: name, daysAway: daysAway(row, job.now) });
  await job.send(email, mail.subject, mail.html);
  const stamped = await job.partners
    .updateOne({ _id: row._id, dormantNudgeAt: null }, { $set: { dormantNudgeAt: job.now } })
    .catch(() => null);
  if (!stamped || (stamped.modifiedCount ?? stamped.nModified ?? 0) === 0) {
    return { status: 'skipped', reason: 'race-lost' };
  }
  return { status: 'sent' };
}

export async function runDormantNudgeJob(deps = {}) {
  const job = buildDormantNudgeJob(deps);
  const started = Date.now();
  const result = {
    at: job.now.toISOString?.() ?? String(job.now),
    checked: 0,
    sent: 0,
    skipped: { 'no-email': 0, suspended: 0, 'already-sent': 0, recent: 0, 'race-lost': 0 },
    failed: [],
  };
  const cutoff = new Date(job.now.getTime() - job.days * DAY);
  try {
    let cursor = null;
    for (;;) {
      const filter = {
        ...(cursor ? { _id: { $gt: cursor } } : {}),
        dormantNudgeAt: null,
        suspendedAt: null,
        email: { $exists: true, $ne: null, $nin: ['', null] },
        $or: [{ lastLoginAt: { $lt: cutoff } }, { lastLoginAt: null, createdAt: { $lt: cutoff } }],
      };
      const page = await job.partners
        .find(filter)
        .sort({ _id: 1 })
        .limit(PARTNER_PAGE)
        .lean()
        .catch(() => []);
      if (page.length === 0) break;
      for (const row of page) {
        result.checked += 1;
        try {
          const outcome = await nudgeCandidate(job, row);
          if (outcome.status === 'sent') result.sent += 1;
          else if (outcome.reason in result.skipped) result.skipped[outcome.reason] += 1;
        } catch (error) {
          result.failed.push({ partner: String(row._id ?? row.id ?? ''), error: error?.message ?? String(error) });
        }
      }
      if (page.length < PARTNER_PAGE) break;
      cursor = page[page.length - 1]._id;
    }
  } catch (error) {
    console.error('[jobs] dormant-nudge crashed:', error?.message ?? error);
    result.failed.push({ error: error?.message ?? String(error) });
  }
  console.log(
    `[jobs] dormant-nudge: ${result.sent}/${result.checked} sent `
    + `(no-email ${result.skipped['no-email']}, suspended ${result.skipped.suspended}, `
    + `already-sent ${result.skipped['already-sent']}, recent ${result.skipped.recent}, race-lost ${result.skipped['race-lost']}, failed ${result.failed.length}) in ${Date.now() - started}ms`,
  );
  return result;
}
