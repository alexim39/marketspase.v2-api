import { GOAL_EVENTS } from '../../goals/domain/GoalEvents.js';
import { buildGoalDone, buildGoalRisk } from '../infrastructure/LifecycleMailer.js';

/**
 * Goal lifecycle fan-out: subscriber of goal events.
 * - atRisk → the direct upline gets in-app + email (forced lifecycle
 *   mail), keyed per goal per ISO week (re-fires weekly at most while the
 *   goal stays at risk). The member is already covered by the daily brief.
 * - completed → the member gets in-app + email, keyed once ever.
 * Everything keyed idempotent; best-effort throughout.
 */
export class GoalFanoutUseCase {
  /** @param {{stored, delivery, partners, network}} deps */
  constructor({ stored, delivery, partners, network }) {
    Object.assign(this, { stored, delivery, partners, network });
  }

  async notifyAtRisk({ partnerId, goalId, title, remaining, daysLeft, requiredDaily, week }) {
    try {
      const node = await this.network?.findNode?.(partnerId).catch(() => null);
      const uplineId = node?.parentId ? String(node.parentId) : null;
      if (!uplineId) return { status: 'skipped', reason: 'no-upline' };
      const rowKey = `goal-risk:${goalId}:${week}`;
      if (await this.stored.findByKey(uplineId, rowKey).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const [member, upline] = await Promise.all([
        this.partners?.findById(partnerId).catch(() => null),
        this.partners?.findById(uplineId).catch(() => null),
      ]);
      const memberName = member
        ? [member.name, member.surname].filter(Boolean).join(' ') || member.username
        : 'A team member';
      const report = await this.delivery.deliver({
        recipientId: uplineId,
        contact: { email: upline?.email ?? null, phone: upline?.phone ?? null },
        item: {
          category: 'team',
          priority: 'high',
          title: `${memberName}'s goal "${title}" is at risk`,
          body: `${remaining ?? '?'} to go with ${daysLeft ?? '?'}d left — check in today.`,
          icon: 'flag',
          link: '/dashboard/network/tree',
          key: rowKey,
        },
        email: buildGoalRisk({
          memberName,
          uplineName: upline
            ? [upline.name, upline.surname].filter(Boolean).join(' ') || upline.username
            : 'Leader',
          title,
          remaining: String(remaining ?? '?'),
          daysLeft: String(daysLeft ?? '?'),
          requiredDaily: String(requiredDaily ?? '?'),
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

  async notifyCompleted({ partnerId, goalId, title }) {
    const rowKey = `goal-done:${goalId}`;
    try {
      if (await this.stored.findByKey(partnerId, rowKey).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const member = await this.partners?.findById(partnerId).catch(() => null);
      const name = member
        ? [member.name, member.surname].filter(Boolean).join(' ') || member.username
        : 'there';
      const report = await this.delivery.deliver({
        recipientId: partnerId,
        contact: { email: member?.email ?? null, phone: member?.phone ?? null },
        item: {
          category: 'goals',
          priority: 'medium',
          title: `Goal smashed: "${title}"`,
          body: 'Target hit. Set your next goal while the momentum is hot.',
          icon: 'celebration',
          link: '/dashboard/goals',
          key: rowKey,
        },
        email: buildGoalDone({ memberName: name, title }),
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
}

/**
 * @param {{events, stored, delivery, partners, network}} deps
 * @returns unsubscribe function
 */
export const subscribeGoalFanout = ({ events, stored, delivery, partners, network }) => {
  const fanout = new GoalFanoutUseCase({ stored, delivery, partners, network });
  const offRisk = events.on(GOAL_EVENTS.AT_RISK, (p) => fanout.notifyAtRisk(p));
  const offDone = events.on(GOAL_EVENTS.COMPLETED, (p) => fanout.notifyCompleted(p));
  return () => { offRisk(); offDone(); };
};
