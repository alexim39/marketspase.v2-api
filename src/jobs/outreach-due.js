import { RunOutreachDueUseCase } from '../modules/outreach/application/Outreach.worker.js';
import { deliverBulkEmail, deliverBulkSms } from '../modules/outreach/application/Outreach.usecases.js';
import { outreachDeps, outreachSms } from '../modules/outreach/infrastructure/Outreach.store.js';
import { sendEmail } from '../services/emailService.js';
import { env } from '../shared/config/env.js';

/**
 * Scheduled outreach firer (every minute, server-local).
 * Claims due outbox rows and runs the shared charge + send core, so
 * scheduled sends cost and record exactly like immediate ones.
 * Jobs never throw into the scheduler — failures are counted, not fatal.
 * `runOutreachDueJob` is exported for tests and triggers.
 */

export const buildOutreachDueJob = (deps = {}) => {
  const stores = outreachDeps(deps);
  const link = outreachSms({ smsEnv: deps.smsEnv ?? env.sms });
  return new RunOutreachDueUseCase({
    schedules: stores.schedules,
    smsEnabled: link.smsEnabled,
    deliver: (job) => deliverBulkSms(
      {
        partners: stores.partners,
        transactions: stores.transactions,
        records: stores.records,
        sms: link.sms,
      },
      job,
    ),
    deliverEmail: (job) => deliverBulkEmail(
      { partners: stores.partners, records: stores.emailRecords, mail: sendEmail },
      job,
    ),
  });
};

export async function runOutreachDueJob(deps = {}) {
  const started = Date.now();
  try {
    const result = await buildOutreachDueJob(deps).execute({});
    if (result.checked > 0) {
      console.log(
        `[jobs] outreach-due: ${result.sent}/${result.checked} fired `
        + `(failed ${result.failed.length}, skipped ${result.skipped}) in ${Date.now() - started}ms`,
      );
    }
    return result;
  } catch (error) {
    console.error('[jobs] outreach-due crashed:', error?.message ?? error);
    return { checked: 0, sent: 0, failed: [{ error: error?.message ?? String(error) }], skipped: 0 };
  }
}
