import { CONTACT_LIST_EVENTS } from '../../crm/domain/ContactListEvents.js';
import { buildContactListSubmitted } from '../infrastructure/LifecycleMailer.js';

/**
 * Contact-list fan-out: subscriber of the submit event.
 * The direct upline gets in-app + email (forced lifecycle mail) with a
 * deep link to the downline-lists surface. Keyed per member+batch so
 * reruns are no-ops; root members (no upline) skip cleanly.
 * Best-effort throughout.
 */
export class ContactListFanoutUseCase {
  /** @param {{stored, delivery, partners, network}} deps */
  constructor({ stored, delivery, partners, network }) {
    Object.assign(this, { stored, delivery, partners, network });
  }

  async notifySubmitted({ partnerId, memberName, batch, count }) {
    try {
      const node = await this.network?.findNode?.(partnerId).catch(() => null);
      const uplineId = node?.parentId ? String(node.parentId) : null;
      if (!uplineId) return { status: 'skipped', reason: 'no-upline' };
      const rowKey = `contact-list:${partnerId}:${batch}`;
      if (await this.stored.findByKey(uplineId, rowKey).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const upline = await this.partners?.findById(uplineId).catch(() => null);
      const name = memberName ?? 'A team member';
      const report = await this.delivery.deliver({
        recipientId: uplineId,
        contact: { email: upline?.email ?? null, phone: upline?.phone ?? null },
        item: {
          category: 'team',
          priority: 'high',
          title: `${name} submitted ${count} contacts — start calling`,
          body: `${name}'s onboarding list is ready. Call the hottest relationships first and book sessions.`,
          icon: 'contact_phone',
          link: '/dashboard/mentorship/team/contact-lists',
          key: rowKey,
        },
        email: buildContactListSubmitted({
          memberName: name,
          uplineName: upline
            ? [upline.name, upline.surname].filter(Boolean).join(' ') || upline.username
            : 'Leader',
          count,
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
}

/**
 * @param {{events, stored, delivery, partners, network}} deps
 * @returns unsubscribe function
 */
export const subscribeContactListFanout = ({ events, stored, delivery, partners, network }) => {
  const fanout = new ContactListFanoutUseCase({ stored, delivery, partners, network });
  return events.on(CONTACT_LIST_EVENTS.SUBMITTED, (p) => fanout.notifySubmitted(p));
};
