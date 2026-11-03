import { PROSPECT_WORKED_EVENTS } from '../../crm/domain/ProspectWorkedEvents.js';

/**
 * Prospect-worked fan-out: subscriber of upline touches.
 * The prospect OWNER gets one in-app row per touch (keyed by touch id so
 * reruns and double-saves are no-ops). Self-touches skip cleanly — you
 * never notify yourself. In-app only (no lifecycle email) to avoid
 * spamming new partners while they learn. Best-effort throughout.
 */
export class ProspectWorkedFanoutUseCase {
  /** @param {{stored, delivery, partners}} deps */
  constructor({ stored, delivery, partners }) {
    Object.assign(this, { stored, delivery, partners });
  }

  async notifyWorked({ prospectId, ownerId, actorId, actorName, kind, label, touchId }) {
    try {
      if (!ownerId || !actorId || String(ownerId) === String(actorId)) {
        return { status: 'skipped', reason: 'self-touch' };
      }
      const rowKey = `prospect-worked:${prospectId}:${touchId || Date.now()}`;
      if (await this.stored.findByKey(ownerId, rowKey).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const owner = await this.partners?.findById(ownerId).catch(() => null);
      const who = actorName ?? 'Your upline';
      const what = kind === 'stage' ? `moved ${label}` : `logged activity on ${label || 'your prospect'}`;
      const report = await this.delivery.deliver({
        recipientId: ownerId,
        contact: { email: owner?.email ?? null, phone: owner?.phone ?? null },
        item: {
          category: 'prospect',
          priority: 'medium',
          title: `${who} ${what}`,
          body: 'Open the prospect to see the update and keep the follow-up going.',
          icon: 'support_agent',
          link: `/dashboard/prospects/detail/${prospectId}`,
          key: rowKey,
        },
        email: null,
        emailPolicy: 'never',
      });
      const reached = report.inApp === 'created' || report.inApp === 'deduped';
      return reached
        ? { status: 'notified' }
        : { status: 'skipped', reason: 'no-channel' };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }
}

/**
 * @param {{events, stored, delivery, partners}} deps
 * @returns unsubscribe function
 */
export const subscribeProspectWorkedFanout = ({ events, stored, delivery, partners }) => {
  const fanout = new ProspectWorkedFanoutUseCase({ stored, delivery, partners });
  return events.on(PROSPECT_WORKED_EVENTS.TOUCHED, (p) => fanout.notifyWorked(p));
};
