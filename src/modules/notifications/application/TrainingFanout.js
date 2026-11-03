import { PROGRESSION_EVENTS } from '../../progression/domain/ProgressionEvents.js';
import { buildTrackComplete, buildTrackCompleteUpline, buildTrainingOutcome, buildTrainingRequest } from '../infrastructure/LifecycleMailer.js';

/**
 * Training-confirmation fan-out: subscriber of the two training events.
 * - requested → the upline gets in-app + email (forced lifecycle mail)
 *   with a deep link to the confirmations page. Skips cleanly for
 *   root members (no upline to ask).
 * - decided → the member gets the outcome in-app + email, including the
 *   decline reason verbatim (required at decision time).
 * Everything keyed idempotent; best-effort throughout.
 */
export class TrainingFanoutUseCase {
  /** @param {{stored, delivery, partners, network}} deps */
  constructor({ stored, delivery, partners, network }) {
    Object.assign(this, { stored, delivery, partners, network });
  }

  async notifyRequest({ partnerId, key, keyLabel, memberName, uplineId, cycle }) {
    try {
      const node = !uplineId ? await this.network?.findNode?.(partnerId).catch(() => null) : null;
      const resolvedUpline = uplineId ?? node?.parentId ?? null;
      if (!resolvedUpline) return { status: 'skipped', reason: 'no-upline' };
      const rowKey = `training-request:${partnerId}:${key}:${cycle ?? 'x'}`;
      if (await this.stored.findByKey(resolvedUpline, rowKey).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const upline = await this.partners?.findById(resolvedUpline).catch(() => null);
      const name = memberName ?? 'A team member';
      const report = await this.delivery.deliver({
        recipientId: resolvedUpline,
        contact: { email: upline?.email ?? null, phone: upline?.phone ?? null },
        item: {
          category: 'training',
          priority: 'high',
          title: `${name} completed ${keyLabel} — please confirm`,
          body: `${name} marked ${keyLabel} as done. Confirm it so their next gate unlocks.`,
          icon: 'fact_check',
          link: '/dashboard/mentorship/team/confirmations',
          key: rowKey,
        },
        email: buildTrainingRequest({
          memberName: name,
          uplineName: upline
            ? [upline.name, upline.surname].filter(Boolean).join(' ') || upline.username
            : 'Leader',
          keyLabel,
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

  async notifyOutcome({ partnerId, key, keyLabel, approved, note, memberName, cycle }) {
    const rowKey = `training-outcome:${partnerId}:${key}:${approved ? 'ok' : 'no'}:${cycle ?? 'x'}`;
    try {
      if (await this.stored.findByKey(partnerId, rowKey).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const member = await this.partners?.findById(partnerId).catch(() => null);
      const name = memberName ?? (member
        ? [member.name, member.surname].filter(Boolean).join(' ') || member.username
        : 'there');
      const report = await this.delivery.deliver({
        recipientId: partnerId,
        contact: { email: member?.email ?? null, phone: member?.phone ?? null },
        item: {
          category: 'training',
          priority: approved ? 'medium' : 'high',
          title: approved ? `Your ${keyLabel} is confirmed!` : `Your ${keyLabel} needs another pass`,
          body: approved
            ? 'Thank you for taking the next step — your journey progress is updated.'
            : `Reason: ${note || 'ask your upline directly.'}`,
          icon: approved ? 'celebration' : 'feedback',
          link: '/dashboard/progress',
          key: rowKey,
        },
        email: buildTrainingOutcome({ memberName: name, keyLabel, approved, note }),
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

  async notifyTrackComplete({ partnerId, memberName }) {
    try {
      const node = await this.network?.findNode?.(partnerId).catch(() => null);
      const uplineId = node?.parentId ? String(node.parentId) : null;
      const member = await this.partners?.findById(partnerId).catch(() => null);
      const name = memberName ?? (member
        ? [member.name, member.surname].filter(Boolean).join(' ') || member.username
        : 'there');
      const contact = { email: member?.email ?? null, phone: member?.phone ?? null };
      const memberKey = `training-track:${partnerId}`;
      let memberStatus = { status: 'skipped', reason: 'already-sent' };
      if (!(await this.stored.findByKey(partnerId, memberKey).catch(() => null))) {
        const report = await this.delivery.deliver({
          recipientId: partnerId,
          contact,
          item: {
            category: 'progression',
            priority: 'high',
            title: 'Training track complete — IPO, QSG, SMO!',
            body: 'All three confirmed. Open My Journey to see what unlocked next.',
            icon: 'celebration',
            link: '/dashboard/progress',
            key: memberKey,
          },
          email: buildTrackComplete({ memberName: name }),
          emailPolicy: 'force',
        });
        const reached = report.inApp === 'created' || report.inApp === 'deduped' || report.email === true;
        memberStatus = reached
          ? { status: 'notified', emailed: report.email === true }
          : { status: 'skipped', reason: 'no-channel' };
      }
      let uplineStatus = { status: 'skipped', reason: 'no-upline' };
      if (uplineId) {
        const uplineKey = `training-track-upline:${partnerId}:${uplineId}`;
        if (!(await this.stored.findByKey(uplineId, uplineKey).catch(() => null))) {
          const upline = await this.partners?.findById(uplineId).catch(() => null);
          const report = await this.delivery.deliver({
            recipientId: uplineId,
            contact: { email: upline?.email ?? null, phone: upline?.phone ?? null },
            item: {
              category: 'team',
              priority: 'medium',
              title: `${name} finished the full training track`,
              body: `${name} completed IPO, QSG and SMO. Recognise them and point at their next gate.`,
              icon: 'military_tech',
              link: '/dashboard/network/tree',
              key: uplineKey,
            },
            email: buildTrackCompleteUpline({
              memberName: name,
              uplineName: upline
                ? [upline.name, upline.surname].filter(Boolean).join(' ') || upline.username
                : 'Leader',
            }),
            emailPolicy: 'force',
          });
          const reached = report.inApp === 'created' || report.inApp === 'deduped' || report.email === true;
          uplineStatus = reached
            ? { status: 'notified', emailed: report.email === true }
            : { status: 'skipped', reason: 'no-channel' };
        } else {
          uplineStatus = { status: 'skipped', reason: 'already-sent' };
        }
      }
      return { member: memberStatus, upline: uplineStatus };
    } catch (error) {
      return { member: { status: 'failed', error: error?.message ?? String(error) }, upline: { status: 'failed', error: error?.message ?? String(error) } };
    }
  }
}

/**
 * @param {{events, stored, delivery, partners, network}} deps
 * @returns unsubscribe function
 */
export const subscribeTrainingFanout = ({ events, stored, delivery, partners, network }) => {
  const fanout = new TrainingFanoutUseCase({ stored, delivery, partners, network });
  const offRequest = events.on(PROGRESSION_EVENTS.TRAINING_CONFIRM_REQUESTED, (p) => fanout.notifyRequest(p));
  const offDecided = events.on(PROGRESSION_EVENTS.TRAINING_CONFIRM_DECIDED, (p) => fanout.notifyOutcome(p));
  const offTrack = events.on(PROGRESSION_EVENTS.TRAINING_TRACK_COMPLETED, (p) => fanout.notifyTrackComplete(p));
  return () => { offRequest(); offDecided(); offTrack(); };
};
