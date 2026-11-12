import { COMPENSATION_EVENTS } from '../../compensation/domain/CompensationEvents.js';
import { buildMentorBonusCredited } from '../infrastructure/LifecycleMailer.js';

const displayName = (partner, fallback = '') => {
  if (!partner) return fallback;
  return [partner.name, partner.surname].filter(Boolean).join(' ')
    || partner.username
    || fallback;
};

/**
 * Notify a mentor/coach when their activation mentor bonus is credited.
 *
 * The wallet credit is already committed before this runs. Delivery is
 * best-effort and idempotent; email is forced lifecycle mail, while push/SMS
 * still follow the partner's notification preferences.
 */
export class MentorBonusFanoutUseCase {
  constructor({ stored, delivery, partners }) {
    Object.assign(this, { stored, delivery, partners });
  }

  async notify({
    bonusId = null,
    mentorId,
    activationPartnerId = null,
    amount,
    balanceAfter = null,
  }) {
    try {
      if (!mentorId) return { status: 'skipped', reason: 'no-mentor' };
      const key = `mentor-bonus:paid:${bonusId || `${mentorId}:${activationPartnerId || amount || 'bonus'}`}`;
      if (await this.stored?.findByKey?.(mentorId, key).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }

      const [mentor, activationPartner] = await Promise.all([
        this.partners?.findById(mentorId).catch(() => null),
        activationPartnerId
          ? this.partners?.findById(activationPartnerId).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!mentor) return { status: 'skipped', reason: 'mentor-not-found' };
      if (mentor.suspendedAt) return { status: 'skipped', reason: 'mentor-suspended' };

      const amountLabel = Number(amount || 0).toLocaleString('en-NG');
      const balanceLabel = Number(balanceAfter || 0).toLocaleString('en-NG');
      const memberName = displayName(activationPartner, '');
      const mentorName = displayName(mentor, 'Partner');
      const reason = memberName
        ? `because ${memberName} activated in your team`
        : 'because a new partner activated in your team';
      const balanceLine = balanceAfter !== null && balanceAfter !== undefined
        ? ` New wallet balance: ₦${balanceLabel}.`
        : '';

      const item = {
        category: 'commission',
        priority: 'high',
        title: `₦${amountLabel} mentor/coach bonus credited`,
        body: `Your wallet has been credited with a ₦${amountLabel} mentor/coach bonus ${reason}.${balanceLine}`,
        icon: 'account_balance_wallet',
        link: '/dashboard/wallet/history',
        key,
      };

      const report = await this.delivery.deliver({
        recipientId: String(mentorId),
        contact: { email: mentor.email ?? null, phone: mentor.phone ?? null },
        item,
        email: buildMentorBonusCredited({
          mentorName,
          memberName,
          amount,
          balanceAfter,
        }),
        emailPolicy: 'force',
      });

      const reached = report.inApp === 'created'
        || report.inApp === 'deduped'
        || report.email === true;
      return reached
        ? { status: 'notified', emailed: report.email === true, report }
        : { status: 'skipped', reason: 'no-channel', report };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }
}

/**
 * @param {{events, stored, delivery, partners}} deps
 * @returns {() => void} unsubscribe
 */
export const subscribeMentorBonusFanout = ({ events, stored, delivery, partners }) => {
  const fanout = new MentorBonusFanoutUseCase({ stored, delivery, partners });
  return events.on(
    COMPENSATION_EVENTS.MENTOR_BONUS_PAID,
    (payload) => fanout.notify(payload),
  );
};
