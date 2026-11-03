import { PROGRESSION_EVENTS } from '../../progression/domain/ProgressionEvents.js';
import { buildPromotionMember, buildPromotionUpline } from '../infrastructure/LifecycleMailer.js';

/**
 * Promotion fan-out: subscriber of `progression.promoted`.
 * The member gets congratulations + next steps; the upline gets a
 * recognition nudge — both in-app AND email (forced lifecycle mail),
 * both keyed per member+rank so reruns are no-ops. Best-effort throughout.
 */
export class PromotionFanoutUseCase {
  /** @param {{stored, delivery, partners, network, notify?}} deps */
  constructor({ stored, delivery, partners, network }) {
    Object.assign(this, { stored, delivery, partners, network });
  }

  async notifyMember({ partnerId, to, toLabel, memberName }) {
    const key = `promotion:${partnerId}:${to}`;
    try {
      if (await this.stored.findByKey(partnerId, key).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const member = await this.partners?.findById(partnerId).catch(() => null);
      const name = memberName ?? (member
        ? [member.name, member.surname].filter(Boolean).join(' ') || member.username
        : 'Leader');
      const report = await this.delivery.deliver({
        recipientId: partnerId,
        contact: { email: member?.email ?? null, phone: member?.phone ?? null },
        item: {
          category: 'progression',
          priority: 'high',
          title: `You reached ${toLabel}!`,
          body: `Congratulations — you are now ${toLabel}. Open My Journey to see your next gate.`,
          icon: 'celebration',
          link: '/dashboard/progress',
          key,
        },
        email: buildPromotionMember({ memberName: name, toLabel }),
        emailPolicy: 'force',
      });
      const reached = report.inApp === 'created' || report.inApp === 'deduped' || report.email === true;
      return reached
        ? { status: 'notified', emailed: report.email === true }
        : { status: 'skipped', reason: 'no-channel' };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }

  async notifyUpline({ partnerId, to, toLabel, memberName, uplineId }) {
    try {
      const node = !uplineId ? await this.network?.findNode?.(partnerId).catch(() => null) : null;
      const resolvedUpline = uplineId ?? node?.parentId ?? null;
      if (!resolvedUpline) return { status: 'skipped', reason: 'no-upline' };
      const key = `promotion-upline:${partnerId}:${to}`;
      if (await this.stored.findByKey(resolvedUpline, key).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const upline = await this.partners?.findById(resolvedUpline).catch(() => null);
      const name = memberName ?? 'A team member';
      const report = await this.delivery.deliver({
        recipientId: resolvedUpline,
        contact: { email: upline?.email ?? null, phone: upline?.phone ?? null },
        item: {
          category: 'team',
          priority: 'medium',
          title: `${name} just reached ${toLabel}`,
          body: `Someone in your downline earned a promotion. Congratulate them and review their next gate together.`,
          icon: 'military_tech',
          link: '/dashboard/network/tree',
          key,
        },
        email: buildPromotionUpline({
          memberName: name,
          toLabel,
          uplineName: upline
            ? [upline.name, upline.surname].filter(Boolean).join(' ') || upline.username
            : 'Leader',
        }),
        emailPolicy: 'force',
      });
      const reached = report.inApp === 'created' || report.inApp === 'deduped' || report.email === true;
      return reached
        ? { status: 'notified', emailed: report.email === true }
        : { status: 'skipped', reason: 'no-channel' };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }

  async execute(payload) {
    const [member, upline] = await Promise.all([
      this.notifyMember(payload),
      this.notifyUpline(payload),
    ]);
    return { member, upline };
  }
}

/**
 * @param {{events, stored, delivery, partners, network}} deps
 * @returns unsubscribe function
 */
export const subscribePromotionFanout = ({ events, stored, delivery, partners, network }) => {
  const fanout = new PromotionFanoutUseCase({ stored, delivery, partners, network });
  return events.on(PROGRESSION_EVENTS.PROMOTED, (payload) => fanout.execute(payload));
};
