import { BookingModel } from '../apps/booking/models/booking.model.js';
import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { buildSmsSender } from '../modules/notifications/infrastructure/SmsSender.js';
import { buildPushSender } from '../modules/notifications/infrastructure/PushSender.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { env } from '../shared/config/env.js';

/**
 * Session reminders (every 15 min): T-24h and T-1h nudges for booked
 * presentations. Prospect gets an SMS; the owner gets push + an in-app
 * row (keyed, so reruns dedupe instead of double-notifying).
 *
 * Idempotency: `reminded24hAt` / `reminded1hAt` stamps on the booking,
 * written atomically behind a null-check — parallel dynos and overlapping
 * windows can never double-send. Late bookings (< 24h out) simply skip
 * the 24h leg and still catch the 1h leg. Cancelled/completed/no-show
 * sessions are never reminded.
 * `runSessionRemindersJob` is exported for tests and triggers.
 */

const HOUR = 3600000;
const ACTIVE_STATUSES = ['Scheduled', 'Rebooked', 'In Progress'];

/** Combine a booking's date + time parts into one session start (null = unusable). */
export const sessionStartOf = (booking) => {
  const day = booking?.consultDate ? new Date(booking.consultDate) : null;
  if (!day || Number.isNaN(day.getTime())) return null;
  const t = booking?.consultTime;
  let hh = 9;
  let mm = 0;
  if (t instanceof Date && !Number.isNaN(t.getTime())) {
    hh = t.getHours();
    mm = t.getMinutes();
  } else if (typeof t === 'string') {
    const m = t.trim().match(/^(\d{1,2})[:.](\d{2})/);
    if (!m) return null;
    hh = Number(m[1]);
    mm = Number(m[2]);
    if (hh > 23 || mm > 59) return null;
  } else {
    return null;
  }
  const start = new Date(day);
  start.setHours(hh, mm, 0, 0);
  return start;
};

/** Which reminder legs a session start qualifies for right now. */
export const dueLegs = (start, now = new Date()) => {
  const ms = new Date(start).getTime() - new Date(now).getTime();
  return {
    h24: ms > 23 * HOUR && ms <= 25 * HOUR,
    h1: ms > 0 && ms <= 75 * 60 * 1000,
  };
};

export const reminderCopy = (leg, { prospectName, ownerName, reason, when }) => {
  const who = prospectName || 'there';
  if (leg === 'h24') {
    return {
      sms: `Hi ${who}, reminder: your session with ${ownerName} (${reason}) is tomorrow at ${when}. Reply if anything changes.`,
      title: `Session tomorrow: ${prospectName || 'Prospect'}`,
      body: `${reason} at ${when} — session link and details are on My sessions.`,
    };
  }
  return {
    sms: `Hi ${who}, your session with ${ownerName} (${reason}) starts in about an hour (${when}). See you soon.`,
    title: `Session in an hour: ${prospectName || 'Prospect'}`,
    body: `${reason} at ${when} — time to join. Details on My sessions.`,
  };
};

export const buildSessionRemindersJob = (deps = {}) => ({
  now: deps.now ?? new Date(),
  bookings: deps.bookings ?? BookingModel,
  partners: deps.partners ?? PartnersModel,
  sms: deps.sms ?? buildSmsSender(env.sms),
  push: deps.push ?? buildPushSender(env.push, env.appBaseUrl),
  notify: deps.notify ?? new NotifyUseCase({ stored: deps.stored ?? new MongoStoredNotificationStore() }),
  stored: deps.stored ?? new MongoStoredNotificationStore(),
});

const prospectNameOf = (b) => `${b?.name ?? ''} ${b?.surname ?? ''}`.trim();
const whenOf = (start) => start.toLocaleString('en-NG', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

async function remindBooking(job, booking, result) {
  const start = sessionStartOf(booking);
  if (!start) return { status: 'skipped', reason: 'bad-date' };
  const legs = dueLegs(start, job.now);
  const wanted = legs.h24 && !booking.reminded24hAt ? 'h24' : legs.h1 && !booking.reminded1hAt ? 'h1' : null;
  if (!wanted) return { status: 'skipped', reason: 'not-due' };

  const owner = await job.partners
    .findOne({ username: booking.username })
    .select('_id name surname username phone')
    .lean()
    .catch(() => null);
  if (!owner) return { status: 'skipped', reason: 'no-owner' };
  const ownerId = String(owner._id);
  const ownerName = `${owner.name ?? ''} ${owner.surname ?? ''}`.trim() || owner.username || 'Your coach';
  const copy = reminderCopy(wanted, {
    prospectName: prospectNameOf(booking),
    ownerName,
    reason: booking.reason || 'One-on-one session',
    when: whenOf(start),
  });

  // Prospect SMS first (best-effort — a bad number skips, never fails).
  let smsSent = false;
  try {
    if (booking.phone) {
      await job.sms.send({ to: booking.phone, title: 'Session reminder', body: copy.sms });
      smsSent = true;
    }
  } catch {
    return { status: 'skipped', reason: 'sms-failed' };
  }
  if (!smsSent && !booking.phone) return { status: 'skipped', reason: 'no-phone' };

  // Atomic stamp BEFORE the owner fan-out: the send already happened, so
  // even a crash below cannot cause a second SMS for this leg.
  const stampField = wanted === 'h24' ? 'reminded24hAt' : 'reminded1hAt';
  const stamped = await job.bookings
    .updateOne({ _id: booking._id, [stampField]: null }, { $set: { [stampField]: job.now } })
    .catch(() => null);
  if (!stamped || (stamped.modifiedCount ?? stamped.nModified ?? 0) === 0) {
    return { status: 'skipped', reason: 'race-lost' };
  }

  // Owner in-app row (keyed — reruns dedupe) + push to live devices.
  try {
    await job.notify.execute({
      recipientId: ownerId,
      category: 'prospect',
      priority: wanted === 'h1' ? 'high' : 'medium',
      title: copy.title,
      body: copy.body,
      icon: 'event_note',
      link: '/dashboard/prospects/bookings',
      key: `session:${booking._id}:${wanted}`,
    });
  } catch { /* in-app is celebratory next to the SMS — never fatal */ }
  try {
    const subs = await job.stored.listSubscriptions(ownerId).catch(() => []);
    for (const sub of subs) {
      try {
        const out = await job.push.send({
          subscription: { endpoint: sub.endpoint, keys: sub.keys },
          title: copy.title,
          body: copy.body,
          link: '/dashboard/prospects/bookings',
        });
        if (out?.gone) await job.stored.pruneSubscription(ownerId, sub.endpoint).catch(() => null);
      } catch { /* per-device failures never fail the run */ }
    }
  } catch { /* push transport down — SMS already sent */ }
  return { status: 'sent', leg: wanted };
}

export async function runSessionRemindersJob(deps = {}) {
  const job = buildSessionRemindersJob(deps);
  const started = Date.now();
  const result = {
    at: job.now.toISOString?.() ?? String(job.now),
    checked: 0,
    sent: { h24: 0, h1: 0 },
    skipped: {},
    failed: [],
  };
  const skip = (reason) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  };
  try {
    const rows = await job.bookings
      .find({ status: { $in: ACTIVE_STATUSES } })
      .select('_id username name surname phone email reason consultDate consultTime status reminded24hAt reminded1hAt')
      .sort({ consultDate: 1 })
      .limit(1000)
      .lean()
      .catch(() => []);
    for (const booking of rows) {
      result.checked += 1;
      try {
        const outcome = await remindBooking(job, booking, result);
        if (outcome.status === 'sent') result.sent[outcome.leg] += 1;
        else skip(outcome.reason);
      } catch (error) {
        result.failed.push({ booking: String(booking._id ?? ''), error: error?.message ?? String(error) });
      }
    }
  } catch (error) {
    console.error('[jobs] session-reminders crashed:', error?.message ?? error);
    result.failed.push({ error: error?.message ?? String(error) });
  }
  console.log(
    `[jobs] session-reminders: h24 ${result.sent.h24}, h1 ${result.sent.h1} / ${result.checked} checked `
    + `(failed ${result.failed.length}) in ${Date.now() - started}ms`,
  );
  return result;
}
