import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { sendEmail } from '../services/emailService.js';
import { userBirthdayEmailTemplate } from '../apps/partner/services/email/birthday.js';

/**
 * Birthday greetings (08:00 daily). Same conventions as the snapshot job:
 * pure date helper, injectable deps, no side effects on import — the legacy
 * side-effect scheduler this replaces loaded EVERY partner with a DoB into
 * memory and filtered month/day in JS.
 *
 * Query note: month/day predicates on a Date field defeat B-tree indexes,
 * so DoBs carry derived dobMonth/dobDay parts (schema hooks + backfill)
 * and this query is a plain indexed equality — see the boot manifest.
 */

/** Calendar-day match in server-local time (unit-testable, no Mongo). */
export const isBirthdayToday = (dob, today = new Date()) => {
  const d = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(d.getTime())) return false;
  return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
};

const celebrantsToday = async (partners, today) => partners.find({
  dobMonth: today.getMonth() + 1,
  dobDay: today.getDate(),
}).select('name email dobDatePicker dobMonth dobDay').lean();

export const buildBirthdayJob = (deps = {}) => ({
  partners: deps.partners ?? PartnersModel,
  mailer: deps.mailer ?? sendEmail,
  template: deps.template ?? userBirthdayEmailTemplate,
  today: deps.today ?? new Date(),
});

export async function runBirthdayJob(deps = {}) {
  const { partners, mailer, template, today } = buildBirthdayJob(deps);
  const started = Date.now();
  const sent = [];
  const failed = [];
  try {
    // Belt-and-braces: $expr already matched, but skip anything unparseable
    // rather than mailing on a garbage date.
    const rows = (await celebrantsToday(partners, today)).filter((u) => u.email && isBirthdayToday(u.dobDatePicker, today));
    for (const user of rows) {
      try {
        await mailer(user.email, `Happy Birthday, ${String(user.name ?? '').toUpperCase()}!`, template(user));
        sent.push(String(user._id));
      } catch (error) {
        failed.push({ user: String(user._id), error: error?.message ?? String(error) });
      }
    }
    console.log(`[jobs] birthdays: ${sent.length} sent in ${Date.now() - started}ms (${failed.length} failed)`);
    return { checked: rows.length, sent, failed };
  } catch (error) {
    console.error('[jobs] birthdays crashed:', error?.message ?? error);
    return { checked: 0, sent, failed: [{ error: error?.message ?? String(error) }] };
  }
}
