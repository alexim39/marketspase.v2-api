import { appBaseUrl } from '../../../services/emailService.js';
import { brandEmail } from '../../../services/emailBrand.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const displayName = (partner, fallback = 'there') => (
  [partner?.name, partner?.surname].filter(Boolean).join(' ') || partner?.username || fallback
);

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const taskLink = () => `${appBaseUrl()}/dashboard/team/handoffs`;

const reminderEmail = ({ title, mentorName, memberName, detail }) => brandEmail({
  title,
  body: `<p>Hi ${escapeHtml(mentorName)},</p><p>${escapeHtml(detail)}</p><p>Member: <strong>${escapeHtml(memberName)}</strong></p>`,
  actionUrl: taskLink(),
  actionLabel: 'Open mentor tasks',
});

/**
 * Runs the approved follow-up playbook:
 * 24h reminder → 48h reminder → day-7 activation/training check → escalation.
 * A task receives at most one reminder per run; earlier missing reminders are
 * stamped so an overdue task cannot produce a burst of duplicate messages.
 */
export class MentorHandoffReminderUseCase {
  constructor({ handoffs, delivery, partners = PartnersModel }) {
    Object.assign(this, { handoffs, delivery, partners });
  }

  async run(now = new Date()) {
    const tasks = await this.handoffs.listReminderCandidates(now);
    const result = { checked: tasks.length, reminders: 0, escalated: 0, skipped: 0, failed: 0 };
    for (const task of tasks) {
      try {
        if (task.preference === 'prefer_not_now') {
          result.skipped += 1;
          continue;
        }
        const [member, mentor] = await Promise.all([
          this.partners.findById(task.partnerId).catch(() => null),
          this.partners.findById(task.mentorId).catch(() => null),
        ]);
        if (!member || !mentor) {
          result.skipped += 1;
          continue;
        }
        const age = now.getTime() - new Date(task.joinedAt).getTime();
        const memberName = displayName(member);
        const mentorName = displayName(mentor, 'Mentor');
        const activated = Boolean(member.activatedAt) || member.accountState === 'partner';

        let field = null;
        let title = '';
        let detail = '';
        if (age >= 7 * DAY_MS && !task.day7At) {
          field = 'day7At';
          title = 'Day 7 mentor check-in';
          detail = activated
            ? `Check ${memberName}'s training progress and agree the next step.`
            : `${memberName} has not activated yet. Check in and help with the next step.`;
        } else if (age >= 2 * DAY_MS && !task.reminder48At) {
          field = 'reminder48At';
          title = '48-hour mentor reminder';
          detail = task.firstContactAt
            ? `You have contacted ${memberName}. Keep the onboarding moving and check their progress.`
            : `${memberName} has not been contacted yet. Send an approved welcome message today.`;
        } else if (age >= DAY_MS && !task.reminder24At) {
          field = 'reminder24At';
          title = '24-hour mentor reminder';
          detail = `Send ${memberName} a welcome message and help them take the first step.`;
        }
        if (!field) {
          result.skipped += 1;
          continue;
        }

        const report = await this.delivery.deliver({
          recipientId: task.mentorId,
          contact: { email: mentor.email ?? null, phone: mentor.phone ?? null },
          item: {
            category: 'team',
            priority: field === 'day7At' ? 'high' : 'medium',
            title,
            body: detail,
            icon: 'assignment_ind',
            link: '/dashboard/team/handoffs',
            key: `mentor-handoff:${field}:${task._id}`,
          },
          email: reminderEmail({ title, mentorName, memberName, detail }),
          emailPolicy: 'force',
        });
        const delivered = report?.inApp === 'created'
          || report?.inApp === 'deduped'
          || report?.email === true
          || report?.sms === true
          || Number(report?.push ?? 0) > 0;
        if (!delivered) {
          result.failed += 1;
          continue;
        }

        if (field === 'day7At' && !task.firstContactAt && !task.escalatedAt) {
          const escalated = await this.escalate(task, mentor, member, now);
          if (escalated) result.escalated += 1;
        }

        await this.handoffs.markReminder(task._id, field, now);
        if (field === 'day7At') {
          if (!task.reminder24At) await this.handoffs.markReminder(task._id, 'reminder24At', now);
          if (!task.reminder48At) await this.handoffs.markReminder(task._id, 'reminder48At', now);
        }
        result.reminders += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  async escalate(task, mentor, member, now) {
    const memberName = displayName(member);
    const mentorName = displayName(mentor, 'Mentor');
    const recipientIds = new Set();
    if (mentor.partnerOf) recipientIds.add(String(mentor.partnerOf));
    const admins = await this.partners.find({ role: { $in: ['admin', 'Admin', 'ADMIN'] } })
      .select('_id')
      .limit(20)
      .lean()
      .catch(() => []);
    for (const admin of admins ?? []) recipientIds.add(String(admin._id));
    if (recipientIds.size === 0) return false;

    const title = `Escalation: ${memberName} still needs a mentor`;
    const detail = `${memberName} joined ${mentorName}'s team but has no recorded contact after 7 days. Please help reconnect them.`;
    for (const recipientId of recipientIds) {
      const recipient = await this.partners.findById(recipientId).catch(() => null);
      if (!recipient) continue;
      await this.delivery.deliver({
        recipientId,
        contact: { email: recipient.email ?? null, phone: recipient.phone ?? null },
        item: {
          category: 'team',
          priority: 'high',
          title,
          body: detail,
          icon: 'escalator_warning',
          link: '/dashboard/team/handoffs',
          key: `mentor-handoff:escalated:${task._id}:${recipientId}`,
        },
        email: reminderEmail({ title, mentorName: displayName(recipient, 'Leader'), memberName, detail }),
        emailPolicy: 'force',
      });
    }
    await this.handoffs.markReminder(task._id, 'escalatedAt', now);
    return true;
  }
}
