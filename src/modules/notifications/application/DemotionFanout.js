import { PROGRESSION_EVENTS } from '../../progression/domain/ProgressionEvents.js';

/**
 * Notify the member and their upline when a scheduled review moves the
 * journey rank down. Messaging/circle sync is handled by the rank-group
 * subscriber through the same event.
 */
export class DemotionFanoutUseCase {
  constructor({ delivery, partners }) {
    Object.assign(this, { delivery, partners });
  }

  async notifyMember({ partnerId, fromLabel, toLabel }) {
    try {
      const key = `demotion:member:${partnerId}:${toLabel}:${new Date().toISOString().slice(0, 7)}`;
      const report = await this.delivery.deliver({
        recipientId: partnerId,
        item: {
          category: 'progression',
          priority: 'high',
          title: `Your journey rank moved to ${toLabel}`,
          body: `Our monthly review found the ${fromLabel} maintenance requirement was not met for consecutive reviews. Your journey rank is now ${toLabel}. Keep building — the path back is still open.`,
          icon: 'trending_down',
          link: '/dashboard/progress',
          key,
        },
      });
      return {
        status: report.inApp === 'created' || report.inApp === 'deduped' ? 'notified' : 'skipped',
        report,
      };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }

  async notifyUpline({ partnerId, uplineId, toLabel, memberName = null }) {
    if (!uplineId) return { status: 'skipped', reason: 'no-upline' };
    try {
      const member = await this.partners?.findById?.(partnerId).catch(() => null);
      const name = memberName
        || (member ? [member.name, member.surname].filter(Boolean).join(' ') || member.username : 'A team member');
      const key = `demotion:upline:${partnerId}:${toLabel}:${new Date().toISOString().slice(0, 7)}`;
      const report = await this.delivery.deliver({
        recipientId: uplineId,
        item: {
          category: 'team',
          priority: 'medium',
          title: `${name} moved back to ${toLabel}`,
          body: 'A monthly rank review found sustained maintenance below the previous rank. Reach out and help them rebuild momentum.',
          icon: 'support_agent',
          link: '/dashboard/network/tree',
          key,
        },
      });
      return {
        status: report.inApp === 'created' || report.inApp === 'deduped' ? 'notified' : 'skipped',
        report,
      };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }

  async execute(payload = {}) {
    return {
      member: await this.notifyMember(payload),
      upline: await this.notifyUpline(payload),
    };
  }
}

export const subscribeDemotionFanout = ({ events, delivery, partners }) => {
  const fanout = new DemotionFanoutUseCase({ delivery, partners });
  return events.on(PROGRESSION_EVENTS.DEMOTED, (payload) => fanout.execute(payload));
};
