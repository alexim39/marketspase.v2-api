import {
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { appBaseUrl, sendEmail } from '../../../services/emailService.js';
import { brandEmail } from '../../../services/emailBrand.js';
import { smsBody } from '../../notifications/domain/Delivery.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import {
  MENTOR_CONTACT_PREFERENCES,
  MENTOR_HANDOFF_TEMPLATES,
  findMentorHandoffTemplate,
  renderMentorHandoffTemplate,
} from '../domain/MentorHandoff.domain.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const displayName = (partner, fallback = 'there') => (
  [partner?.name, partner?.surname].filter(Boolean).join(' ') || partner?.username || fallback
);

const isValidId = (value) => /^[a-fA-F0-9]{24}$/.test(String(value ?? ''));

const normalizePreference = (value) => (
  MENTOR_CONTACT_PREFERENCES.includes(value) ? value : null
);

const chatUrl = (mentorId, mentorName) => (
  `${appBaseUrl()}/dashboard/messages?chat=${encodeURIComponent(mentorId)}&chatName=${encodeURIComponent(mentorName)}`
);

export class ListMentorHandoffsUseCase {
  constructor({ handoffs }) {
    this.handoffs = handoffs;
  }

  execute(mentorId, query = {}) {
    return this.handoffs.listForMentor(mentorId, query);
  }
}

export class ListMentorHandoffTemplatesUseCase {
  execute() {
    return MENTOR_HANDOFF_TEMPLATES.map(({ key, label, subject, body }) => ({
      key,
      label,
      subject,
      body,
    }));
  }
}

export class SendMentorHandoffIntroUseCase {
  constructor({ handoffs, partners, messages, mail = sendEmail, sms = null }) {
    Object.assign(this, { handoffs, partners, messages, mail, sms });
  }

  async execute({ mentorId, handoffId, templateKey }) {
    if (!isValidId(handoffId)) throw new ValidationException('Invalid handoff');
    const task = await this.handoffs.findForMentor(handoffId, mentorId);
    if (!task) throw new NotFoundException('Mentor task not found');
    if (task.preference === 'prefer_not_now') {
      throw new ForbiddenException('This member asked not to be contacted yet');
    }
    const template = findMentorHandoffTemplate(templateKey);
    if (!template) throw new ValidationException('Choose one of the approved messages');

    const [member, mentor] = await Promise.all([
      this.partners.findById(task.partnerId).catch(() => null),
      this.partners.findById(task.mentorId).catch(() => null),
    ]);
    if (!member) throw new NotFoundException('Member not found');
    if (!mentor) throw new NotFoundException('Mentor not found');

    const memberName = displayName(member);
    const mentorName = displayName(mentor, 'Your mentor');
    const text = renderMentorHandoffTemplate(template, { memberName, mentorName });
    const link = chatUrl(task.mentorId, mentorName);

    const message = await this.messages.create({
      senderId: task.mentorId,
      recipientId: task.partnerId,
      kind: 'direct',
      title: template.label,
      body: `${text}\n\nReply in MarketSpase Chat: ${link}`.slice(0, 2000),
    });

    const channels = { chat: Boolean(message), email: false, sms: false };

    if (member.email && this.mail) {
      try {
        const subject = template.subject;
        const html = brandEmail({
          title: subject,
          body: `<p>${escapeHtml(text)}</p>`,
          actionUrl: link,
          actionLabel: 'Reply in MarketSpase Chat',
        });
        const receipt = await this.mail(member.email, subject, html);
        channels.email = receipt?.sent !== false;
      } catch {
        channels.email = false;
      }
    }

    if (member.phone && this.sms) {
      try {
        const receipt = await this.sms.send({
          to: member.phone,
          title: template.subject,
          body: smsBody(template.subject, `${text} Reply: ${link}`),
        });
        // The disabled sender logs instead of sending; don't claim delivery.
        channels.sms = receipt?.logged !== true;
      } catch {
        channels.sms = false;
      }
    }

    if (!channels.chat && !channels.email && !channels.sms) {
      throw new ValidationException('No delivery channel is available for this member');
    }

    const updated = await this.handoffs.recordSent(handoffId, mentorId, {
      templateKey: template.key,
      channels,
    });
    const shaped = this.handoffs.findForMentor
      ? await this.handoffs.findForMentor(handoffId, mentorId).catch(() => null)
      : null;
    return {
      handoff: shaped ? { ...shaped, ...updated } : updated,
      templateKey: template.key,
      channels,
    };
  }
}

export class MarkMentorHandoffContactedUseCase {
  constructor({ handoffs }) {
    this.handoffs = handoffs;
  }

  async execute({ mentorId, handoffId, note = '' }) {
    if (!isValidId(handoffId)) throw new ValidationException('Invalid handoff');
    const updated = await this.handoffs.markContacted(handoffId, mentorId, note);
    if (!updated) throw new NotFoundException('Mentor task not found');
    const shaped = this.handoffs.findForMentor
      ? await this.handoffs.findForMentor(handoffId, mentorId).catch(() => null)
      : null;
    return shaped ? { ...shaped, ...updated } : updated;
  }
}

export class UpdateMentorContactPreferenceUseCase {
  constructor({ handoffs, partners = PartnersModel }) {
    this.handoffs = handoffs;
    this.partners = partners;
  }

  async execute({ partnerId, preference, consent = false }) {
    const clean = normalizePreference(preference);
    if (!clean) throw new ValidationException('Choose a valid mentor contact preference');
    const partner = await this.partners.findById(partnerId).catch(() => null);
    if (!partner) throw new NotFoundException('Partner not found');
    const needsConsent = ['email', 'whatsapp', 'phone'].includes(clean);
    if (needsConsent && consent !== true) {
      throw new ValidationException('Agree to share your chosen contact channel with your mentor');
    }
    if (clean === 'email' && !partner.email) {
      throw new ValidationException('Add an email address before choosing email');
    }
    if (['whatsapp', 'phone'].includes(clean) && !partner.phone) {
      throw new ValidationException('Add a phone number before choosing WhatsApp or phone');
    }
    const consentAt = needsConsent ? new Date() : null;
    return this.handoffs.updateMemberPreference(partnerId, clean, consentAt);
  }
}
