import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { TransactionModel } from '../apps/transaction/models/transaction.model.js';
import { ErasePartnerUseCase } from '../modules/identity-access/application/Admin.usecase.js';
import { MongoPartnerRepository } from '../modules/identity-access/infrastructure/Auth.mongo.repository.js';
import { MongoProspectRepository } from '../modules/crm/infrastructure/Prospect.mongo.repository.js';
import { MongoTicketRepository } from '../modules/support-ticketing/infrastructure/Ticket.mongo.repository.js';
import { MongoReservationCodes } from '../modules/crm/infrastructure/Prospect.mongo.repository.js';
import { revokeSessions } from '../modules/identity-access/infrastructure/SessionRevocation.js';
import { lenientRole } from '../modules/identity-access/domain/PartnerRole.js';
import { recordAudit } from '../modules/audit/index.js';
import { sendEmail } from '../services/emailService.js';

const DAY = 86400000;
const PARTNER_PAGE = 200;
const REMINDER_WINDOW = 2 * DAY;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const whoOf = (p) => [p?.name, p?.surname].filter(Boolean).join(' ') || p?.username || 'Partner';

/**
 * Self-service erasure sweep (daily 03:30 server-local).
 *
 * Two passes over stamped accounts:
 * 1. Reminders — scheduled within 48h, never reminded: one "last chance to
 *    cancel" mail, then stamp eraseReminderAt (atomic null-check filter so
 *    parallel dynos never double-send).
 * 2. Due executions — scheduledFor reached: re-verify gates explicitly
 *    (downline/last-admin may have regressed mid-cooldown; the erase
 *    usecase double-checks as backstop), run the shared erase, then forfeit
 *    any remaining balance to the ledger. Gate regressions abort the row
 *    (stamps cleared, requester notified) instead of half-erasing; unknown
 *    errors keep the stamps so the next run retries.
 * Jobs never throw into the scheduler — failures are counted, not fatal.
 * `buildErasureDueJob` is exported for tests and triggers.
 */
export const buildErasureDueJob = (deps = {}) => ({
  now: deps.now ?? new Date(),
  partners: deps.partners ?? PartnersModel,
  erase: deps.erase ?? new ErasePartnerUseCase({
    partners: new MongoPartnerRepository(),
    prospects: new MongoProspectRepository(),
    tickets: new MongoTicketRepository(),
    codes: new MongoReservationCodes(),
    sessions: { revoke: (id, opts) => revokeSessions(id, opts) },
  }),
  recordTransaction: deps.recordTransaction ?? ((doc) => TransactionModel.create(doc)),
  send: deps.send ?? sendEmail,
  audit: deps.audit ?? recordAudit,
});

async function mailTo(job, email, subject, html) {
  if (!email) return;
  await job.send(email, subject, html).catch(() => null);
}

async function adminEmails(job) {
  const admins = await job.partners.find({ role: { $in: ['admin', 'Admin', 'ADMIN'] } })
    .select('email').limit(20).lean().catch(() => []);
  return (admins ?? []).map((a) => a?.email).filter(Boolean);
}

async function notifyExecuted(job, row, day) {
  try {
    const who = whoOf(row);
    const upline = row.partnerOf
      ? await job.partners.findById(row.partnerOf).select('name surname email').lean().catch(() => null)
      : null;
    if (row.email) {
      await mailTo(job, row.email, 'Your account has been deleted',
        `<p>Hi ${esc(who)},</p>`
        + `<p>Your Diamond Project account was deleted on <strong>${esc(day)}</strong> as requested.</p>`
        + `<p>Your profile was anonymized and your prospects, tickets and codes removed. Financial records are retained as required by law, and any remaining balance was forfeited to the ledger.</p>`);
    }
    if (upline?.email) {
      await mailTo(job, upline.email, `${who}’s account was deleted`,
        `<p>Hi ${esc(whoOf(upline))},</p>`
        + `<p><strong>${esc(who)}</strong>’s Diamond Project account was deleted on <strong>${esc(day)}</strong> following their own request 30 days ago.</p>`
        + `<p>Their downline was reassigned before execution — no action needed.</p>`);
    }
    for (const email of await adminEmails(job)) {
      await mailTo(job, email, `Self-erasure executed: ${who}`,
        `<p><strong>${esc(who)}</strong>’s account was deleted on <strong>${esc(day)}</strong> (self-requested, 30-day review complete).</p>`);
    }
  } catch { /* notifications never fail execution */ }
}

/** Explicit pre-checks (the erase usecase re-verifies as backstop). */
async function gateError(job, row) {
  if (!row) return 'account no longer exists';
  if (lenientRole(row.role) === 'admin') {
    const remaining = await job.partners.countDocuments({ role: { $in: ['admin', 'Admin', 'ADMIN'] } }).catch(() => 2);
    if (remaining <= 1) return 'cannot erase the last admin';
  }
  // Mid-tree downline is auto-moved at execution — only a root with
  // downline aborts the row.
  const downline = await job.partners.countDocuments({ partnerOf: row._id }).catch(() => 0);
  if (downline > 0 && !row.partnerOf) return `reassign ${downline} downline member(s) first`;
  return null;
}

export async function runErasureDueJob(deps = {}) {
  const job = buildErasureDueJob(deps);
  const now = new Date(job.now).getTime();
  const out = { reminded: 0, executed: 0, aborted: 0, failed: [] };
  try {
    // Pass 1 — 48h reminders (atomic claim via the null-check filter).
    const soon = await job.partners.find({
      eraseScheduledFor: { $gt: new Date(now), $lte: new Date(now + REMINDER_WINDOW) },
      eraseReminderAt: null,
    }).select('_id name surname username email eraseScheduledFor').limit(PARTNER_PAGE).lean().catch(() => []);
    for (const row of soon ?? []) {
      try {
        const claimed = await job.partners.updateOne(
          { _id: row._id, eraseReminderAt: null },
          { $set: { eraseReminderAt: new Date(now) } },
        ).catch(() => null);
        if (!claimed || (claimed.modifiedCount ?? claimed.matchedCount ?? 0) === 0) continue;
        const day = String(row.eraseScheduledFor).slice(0, 10);
        await mailTo(job, row.email, 'Your account deletion is 2 days away',
          `<p>Hi ${esc(whoOf(row))},</p>`
          + `<p>Your Diamond Project account will be deleted on <strong>${esc(day)}</strong>.</p>`
          + `<p>Changed your mind? Sign in and cancel anytime before then in Settings → Delete my account.</p>`);
        out.reminded += 1;
      } catch (error) {
        out.failed.push({ id: String(row._id), error: error?.message ?? String(error) });
      }
    }

    // Pass 2 — due executions. The $exists/$ne guards are load-bearing:
    // BSON orders null below dates, so a bare $lte would match every
    // unstamped partner in the collection.
    const due = await job.partners.find({
      eraseScheduledFor: { $exists: true, $ne: null, $lte: new Date(now) },
    }).limit(PARTNER_PAGE).lean().catch(() => []);
    for (const row of due ?? []) {
      const id = String(row._id);
      try {
        const blocked = await gateError(job, row);
        if (blocked) {
          await job.partners.updateOne(
            { _id: row._id },
            { $unset: { eraseRequestedAt: 1, eraseScheduledFor: 1, eraseReminderAt: 1 } },
          ).catch(() => null);
          await mailTo(job, row.email, 'Account deletion cancelled automatically',
            `<p>Hi ${esc(whoOf(row))},</p>`
            + `<p>Your scheduled account deletion was <strong>cancelled</strong> because: ${esc(blocked)}.</p>`
            + `<p>Resolve it and request again from Settings if you still want to leave.</p>`);
          await job.audit({
            actorId: id, action: 'account.erase-aborted',
            targetType: 'partner', targetId: id, detail: { reason: blocked },
          }).catch(() => null);
          out.aborted += 1;
          continue;
        }
        const balance = Number(row.balance ?? 0);
        await job.erase.execute({ requesterId: id, partnerId: id, viaSelfRequest: true });
        // Policy: remaining balance is forfeited to the (retained) ledger.
        // Best-effort after the point of no return — a forfeit failure is
        // noted, never a reason to unwind the erasure.
        if (Number.isFinite(balance) && balance > 0) {
          try {
            await job.recordTransaction({
              partnerId: row._id,
              amount: -balance,
              reference: `erasure-forfeit-${id}`,
              status: 'completed',
              paymentMethod: 'system',
              transactionType: 'forfeiture',
            });
            await job.partners.updateOne({ _id: row._id }, { $set: { balance: 0 } }).catch(() => null);
          } catch (error) {
            out.failed.push({ id, error: `forfeiture: ${error?.message ?? String(error)}` });
          }
        }
        await job.audit({
          actorId: id, action: 'account.erase-self',
          targetType: 'partner', targetId: id, detail: { forfeited: balance > 0 ? balance : 0 },
        }).catch(() => null);
        await notifyExecuted(job, row, new Date(now).toISOString().slice(0, 10));
        out.executed += 1;
      } catch (error) {
        // Unknown errors keep the stamps — the next run retries.
        out.failed.push({ id, error: error?.message ?? String(error) });
      }
    }
  } catch (error) {
    out.failed.push({ error: error?.message ?? String(error) });
  }
  console.log(`[jobs] erasure-due: ${out.executed} executed, ${out.reminded} reminded, ${out.aborted} aborted (${out.failed.length} failed)`);
  return out;
}
