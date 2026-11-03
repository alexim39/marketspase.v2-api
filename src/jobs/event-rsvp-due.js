import { EventModel, EventRsvpModel, MongoEventStore } from '../modules/events/infrastructure/Events.mongo.repository.js';
import { PartnersModel } from '../apps/partner/models/partner.model.js';
import { buildSmsSender } from '../modules/notifications/infrastructure/SmsSender.js';
import { buildPushSender } from '../modules/notifications/infrastructure/PushSender.js';
import { MongoStoredNotificationStore } from '../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { NotifyUseCase } from '../modules/notifications/application/NotificationsCenter.usecases.js';
import { env } from '../shared/config/env.js';

/**
 * Event RSVP reminders (every 15 min): T-24h and T-1h nudges to going /
 * interested RSVPs. Member SMS first, then the in-app row (keyed, so reruns
 * dedupe), then push to live devices. Mirrors session-reminders: atomic
 * null-check stamps (parallel dynos never double-send), late finds skip
 * the 24h leg, declined RSVPs and past events never remind.
 * `runEventRsvpDueJob` is exported for tests and triggers.
 */

const HOUR = 3600000;

/** Which reminder legs an event start qualifies for right now. */
export const dueLegs = (start, now = new Date()) => {
  const ms = new Date(start).getTime() - new Date(now).getTime();
  return {
    h24: ms > 23 * HOUR && ms <= 25 * HOUR,
    h1: ms > 0 && ms <= 75 * 60 * 1000,
  };
};

export const buildEventRsvpDueJob = (deps = {}) => ({
  now: deps.now ?? new Date(),
  events: deps.events ?? EventModel,
  rsvps: deps.rsvps ?? EventRsvpModel,
  partners: deps.partners ?? PartnersModel,
  store: deps.store ?? new MongoEventStore(),
  sms: deps.sms ?? buildSmsSender(env.sms),
  push: deps.push ?? buildPushSender(env.push, env.appBaseUrl),
  notify: deps.notify ?? new NotifyUseCase({ stored: deps.stored ?? new MongoStoredNotificationStore() }),
  stored: deps.stored ?? new MongoStoredNotificationStore(),
});

const whenOf = (start) => start.toLocaleString('en-NG', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export const reminderCopy = (leg, { eventTitle, when, location }) => {
  const where = location ? ` at ${location}` : '';
  if (leg === 'h24') {
    return {
      sms: `Reminder: "${eventTitle}" is tomorrow (${when})${where}. See you there — reply if plans change.`,
      title: `Event tomorrow: ${eventTitle}`,
      body: `${when}${where} — details on Events.`,
    };
  }
  return {
    sms: `"${eventTitle}" starts in about an hour (${when})${where}. See you soon.`,
    title: `Event in an hour: ${eventTitle}`,
    body: `${when}${where} — time to join. Details on Events.`,
  };
};

async function remindAttendee(job, event, attendee, result) {
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return { status: 'skipped', reason: 'bad-date' };
  const legs = dueLegs(start, job.now);
  const stampField = legs.h24 && !attendee.reminded24hAt
    ? 'reminded24hAt'
    : legs.h1 && !attendee.reminded1hAt ? 'reminded1hAt' : null;
  if (!stampField) return { status: 'skipped', reason: 'not-due' };
  const wanted = stampField === 'reminded24hAt' ? 'h24' : 'h1';

  const me = await job.partners.findById(attendee.partnerId)
    .select('name surname username phone').lean().catch(() => null);
  if (!me) return { status: 'skipped', reason: 'no-member' };
  const who = [me.name, me.surname].filter(Boolean).join(' ') || me.username || 'there';
  const copy = reminderCopy(wanted, {
    eventTitle: event.title, when: whenOf(start), location: event.location,
  });

  // In-app row first (keyed — a retry after an SMS failure dedupes instead
  // of doubling). A notify failure fails the leg without stamping.
  try {
    await job.notify.execute({
      recipientId: String(me._id),
      category: 'community',
      priority: wanted === 'h1' ? 'high' : 'medium',
      title: copy.title,
      body: `Hi ${who}, ${copy.body}`,
      icon: 'event',
      link: '/dashboard/community/events',
      key: `event:${event.id ?? event._id}:${attendee.partnerId}:${wanted}`,
    });
  } catch {
    return { status: 'skipped', reason: 'notify-failed' };
  }

  // Member SMS where a number exists (a bad number skips, never fails).
  if (me.phone) {
    try {
      await job.sms.send({ to: me.phone, title: 'Event reminder', body: `Hi ${who}, ${copy.sms}` });
    } catch {
      return { status: 'skipped', reason: 'sms-failed' };
    }
  }

  // Atomic stamp BEFORE the push fan-out: the sends already happened, so
  // even a crash below cannot cause a second send for this leg.
  const stamped = await job.rsvps
    .updateOne(
      { eventId: event.id ?? event._id, partnerId: attendee.partnerId, [stampField]: null },
      { $set: { [stampField]: job.now } },
    )
    .catch(() => null);
  if (!stamped || (stamped.modifiedCount ?? stamped.nModified ?? 0) === 0) {
    return { status: 'skipped', reason: 'race-lost' };
  }

  // Push to live devices (best-effort — SMS + in-app already landed).
  try {
    const subs = await job.stored.listSubscriptions(String(me._id)).catch(() => []);
    for (const sub of subs) {
      try {
        const out = await job.push.send({
          subscription: { endpoint: sub.endpoint, keys: sub.keys },
          title: copy.title,
          body: copy.body,
          link: '/dashboard/community/events',
        });
        if (out?.gone) await job.stored.pruneSubscription(String(me._id), sub.endpoint).catch(() => null);
      } catch { /* per-device failures never fail the run */ }
    }
  } catch { /* push transport down — SMS + in-app already sent */ }
  return { status: 'sent', leg: wanted };
}

export async function runEventRsvpDueJob(deps = {}) {
  const job = buildEventRsvpDueJob(deps);
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
    const horizon = new Date(new Date(job.now).getTime() + 25 * HOUR);
    const events = await job.events
      .find({ startsAt: { $gt: job.now, $lte: horizon } })
      .select('_id title startsAt location')
      .sort({ startsAt: 1 })
      .limit(200)
      .lean()
      .catch(() => []);
    for (const event of events) {
      const attendees = await job.store.attendees(String(event._id)).catch(() => []);
      for (const attendee of attendees) {
        result.checked += 1;
        try {
          const outcome = await remindAttendee(job, { ...event, id: String(event._id) }, attendee, result);
          if (outcome.status === 'sent') result.sent[outcome.leg] += 1;
          else skip(outcome.reason);
        } catch (error) {
          result.failed.push({ event: String(event._id), error: error?.message ?? String(error) });
        }
      }
    }
  } catch (error) {
    console.error('[jobs] event-rsvp-due crashed:', error?.message ?? error);
    result.failed.push({ error: error?.message ?? String(error) });
  }
  console.log(
    `[jobs] event-rsvp-due: h24 ${result.sent.h24}, h1 ${result.sent.h1} / ${result.checked} checked `
    + `(failed ${result.failed.length}) in ${Date.now() - started}ms`,
  );
  return result;
}
