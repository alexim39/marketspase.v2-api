import { RESERVATION_EVENTS } from '../../reservations/domain/ReservationEvents.js';
import { buildRecruitAlert, buildWelcome } from '../../notifications/infrastructure/LifecycleMailer.js';

/**
 * Activation fan-out — closes the onboarding loop after signup consumes
 * a code. Three legs on `reservation.consumed`:
 * 1. prospect-close: the linked prospect row flips to Converted so it
 *    stops rotting in the pipeline (record-path signups never touched it).
 * 2. upline notify: the referrer gets in-app + email (forced — lifecycle
 *    mail) with concrete next steps, keyed per member (reruns no-op).
 * 3. welcome: the new member gets in-app + email with their first steps.
 * All legs are best-effort with per-recipient isolation; a failure in one
 * never affects the others (or the signup, long committed).
 */
export const activationKey = (partnerId) => `activation:${partnerId}`;
export const welcomeKey = (partnerId) => `welcome:${partnerId}`;

const displayNameOf = (doc, fallback = 'there') => {
  if (!doc) return fallback;
  return [doc.name, doc.surname].filter(Boolean).join(' ') || doc.username || fallback;
};

export const buildActivationHandlers = ({ prospects, stored, notify, delivery = null, partners = null }) => ({
  async closeProspect({ prospectId }) {
    if (!prospectId) return { status: 'skipped', reason: 'no-prospect' };
    try {
      await prospects.updateStatus(prospectId, { stage: 'Converted', name: 'Converted' });
      return { status: 'closed' };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  },

  async notifyUpline({ partnerId, uplineId, memberName }) {
    if (!uplineId) return { status: 'skipped', reason: 'no-upline' };
    const key = activationKey(partnerId);
    try {
      if (await stored.findByKey(uplineId, key).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const upline = await partners?.findById(uplineId).catch(() => null);
      const item = {
        category: 'team',
        priority: 'high',
        title: `${memberName} joined your team`,
        body: `${memberName} just signed up with the referral code you recorded. Schedule their onboarding session and add them to your follow-ups.`,
        icon: 'person_add',
        link: '/dashboard/mentorship/partners/my-partners',
        key,
      };
      if (!delivery) {
        await notify.execute({ recipientId: uplineId, ...item });
        return { status: 'notified', emailed: false };
      }
      const report = await delivery.deliver({
        recipientId: uplineId,
        contact: { email: upline?.email ?? null, phone: upline?.phone ?? null },
        item,
        email: buildRecruitAlert({ memberName, uplineName: displayNameOf(upline, 'Leader') }),
        emailPolicy: 'force',
      });
      const reached = report.inApp === 'created' || report.inApp === 'deduped' || report.email === true;
      return reached
        ? { status: 'notified', emailed: report.email === true }
        : { status: 'skipped', reason: 'no-channel' };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  },

  async welcomeMember({ partnerId, memberName }) {
    const key = welcomeKey(partnerId);
    try {
      if (await stored.findByKey(partnerId, key).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const member = await partners?.findById(partnerId).catch(() => null);
      const item = {
        category: 'system',
        priority: 'high',
        title: `Welcome to MarketSpase, ${memberName}!`,
        body: 'Complete your profile, take the IPO course, add your first prospect and set your first goal — your Daily Action Center guides you daily.',
        icon: 'celebration',
        link: '/dashboard',
        key,
      };
      if (!delivery) {
        await notify.execute({ recipientId: partnerId, ...item });
        return { status: 'welcomed', emailed: false };
      }
      const report = await delivery.deliver({
        recipientId: partnerId,
        contact: { email: member?.email ?? null, phone: member?.phone ?? null },
        item,
        email: buildWelcome({ memberName }),
        emailPolicy: 'force',
      });
      const reached = report.inApp === 'created' || report.inApp === 'deduped' || report.email === true;
      return reached
        ? { status: 'welcomed', emailed: report.email === true }
        : { status: 'skipped', reason: 'no-channel' };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  },
});

/**
 * @param {{events, prospects, stored, notify, delivery?, partners?}} deps
 * @returns unsubscribe function
 */
export const subscribeActivation = ({ events, prospects, stored, notify, delivery = null, partners = null }) => {
  const handlers = buildActivationHandlers({ prospects, stored, notify, delivery, partners });
  return events.on(RESERVATION_EVENTS.CONSUMED, async (payload) => {
    const [prospect, upline, welcome] = await Promise.all([
      handlers.closeProspect(payload),
      handlers.notifyUpline(payload),
      handlers.welcomeMember(payload),
    ]);
    return { prospect, upline, welcome };
  });
};
