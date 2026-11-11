import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { open } from '../shared/security/fieldCrypto.js';
import { sendEmail } from '../services/emailService.js';
import { userBirthdayEmailTemplate } from '../apps/partner/services/email/birthday.js';
import { resolvePreferences } from '../modules/notifications/domain/StoredNotifications.js';
import { resolveChannels } from '../modules/notifications/domain/Delivery.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';

/**
 * Birthday greetings (08:00 daily).
 *
 * - only active, non-suspended accounts;
 * - in-app and email each follow the member's `birthday` preferences;
 * - one in-app greeting and one email per calendar year;
 * - a failed channel stays unmarked so it can be retried safely;
 * - the in-app key (`birthday:<year>`) additionally makes duplicate runs safe.
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
  suspendedAt: null,
}).select(
  'name email dobDatePicker dobMonth dobDay '
  + 'birthdayGreetingYear birthdayGreetingSentAt birthdayEmailYear birthdayEmailSentAt',
).lean();

export const buildBirthdayJob = (deps = {}) => {
  const store = deps.stored ?? new MongoStoredNotificationStore();
  return {
    partners: deps.partners ?? PartnersModel,
    mailer: deps.mailer ?? sendEmail,
    template: deps.template ?? userBirthdayEmailTemplate,
    today: deps.today ?? new Date(),
    preferences: deps.preferences ?? store,
    notify: deps.notify ?? new NotifyUseCase({ stored: store }),
  };
};

export async function runBirthdayJob(deps = {}) {
  const job = buildBirthdayJob(deps);
  const started = Date.now();
  const year = job.today.getFullYear();
  const now = new Date();
  const result = {
    checked: 0,
    sent: { inApp: 0, email: 0 },
    skipped: { optedOut: 0, alreadySent: 0, invalidDate: 0, noEmail: 0 },
    failed: [],
  };

  try {
    const rows = await celebrantsToday(job.partners, job.today);
    result.checked = rows.length;

    for (const user of rows) {
      if (!isBirthdayToday(open(user.dobDatePicker), job.today)) {
        result.skipped.invalidDate += 1;
        continue;
      }

      const storedPrefs = await job.preferences.getPreferences(user._id).catch(() => null);
      const prefs = resolvePreferences(storedPrefs);
      const channels = resolveChannels({ prefs, category: 'birthday' });

      if (!channels.inApp && !channels.email) {
        result.skipped.optedOut += 1;
        continue;
      }

      const name = String(user.name ?? '').trim() || 'Partner';
      const subject = `Happy Birthday, ${name}!`.slice(0, 120);
      let attempted = false;

      if (channels.inApp && Number(user.birthdayGreetingYear) !== year) {
        attempted = true;
        try {
          await job.notify.execute({
            recipientId: String(user._id),
            category: 'birthday',
            priority: 'low',
            title: subject,
            body: `Wishing you a very happy birthday from all of us at MarketSpase. Have a wonderful day, ${name}.`,
            icon: 'cake',
            link: '/dashboard',
            key: `birthday:${year}`,
          });
          await job.partners.updateOne(
            { _id: user._id },
            { $set: { birthdayGreetingYear: year, birthdayGreetingSentAt: now } },
          );
          result.sent.inApp += 1;
        } catch (error) {
          result.failed.push({
            user: String(user._id),
            channel: 'inApp',
            error: error?.message ?? String(error),
          });
        }
      }

      if (channels.email) {
        if (!user.email) {
          result.skipped.noEmail += 1;
          attempted = true;
        } else if (Number(user.birthdayEmailYear) !== year) {
          attempted = true;
          try {
            await job.mailer(user.email, subject, job.template(user));
            await job.partners.updateOne(
              { _id: user._id },
              { $set: { birthdayEmailYear: year, birthdayEmailSentAt: now } },
            );
            result.sent.email += 1;
          } catch (error) {
            result.failed.push({
              user: String(user._id),
              channel: 'email',
              error: error?.message ?? String(error),
            });
          }
        }
      }

      if (!attempted) result.skipped.alreadySent += 1;
    }

    console.log(
      `[jobs] birthdays: ${result.sent.inApp} in-app, ${result.sent.email} email `
      + `(${result.skipped.optedOut} opted out, ${result.skipped.alreadySent} already sent, `
      + `${result.failed.length} failed) in ${Date.now() - started}ms`,
    );
    return result;
  } catch (error) {
    console.error('[jobs] birthdays crashed:', error?.message ?? error);
    result.failed.push({ error: error?.message ?? String(error) });
    return result;
  }
}
