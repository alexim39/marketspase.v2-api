import { ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { UpdateProspectStatusUseCase } from '../../crm/application/Prospect.commands.js';
import { LogCommunicationUseCase } from '../../crm/application/Prospect.communications.js';
import { SaveOraPlanUseCase } from './Ora.plan.usecases.js';
import { MongoOraPlanStore } from '../infrastructure/Ora.mongo.repository.js';
import { buildSmsSender } from '../../notifications/infrastructure/SmsSender.js';
import { MENTOR_CONTACT_LABELS } from '../../mentor-handoff/domain/MentorHandoff.domain.js';
import { sendEmail } from '../../../services/emailService.js';
import { env } from '../../../shared/config/env.js';

const STAGES = ['New', 'Contacted', 'Interested', 'In Negotiation', 'Converted', 'Closed'];
const asDate = (value, field) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationException(`Invalid ${field}`);
  return date;
};

/**
 * Executes an approved Ora action. Every path re-checks ownership and consent
 * on live data — the stored payload is a proposal, never an authority.
 */
export class OraActionExecutor {
  constructor({
    prospects,
    logCommunication,
    updateStatus,
    savePlan,
    mail = sendEmail,
    sms = null,
    partners = null,
    handoffs = null,
    messages = null,
    submitTicket = null,
  } = {}) {
    this.prospects = prospects ?? new MongoProspectRepository();
    this.logCommunication = logCommunication ?? new LogCommunicationUseCase({ prospects: this.prospects });
    this.updateStatus = updateStatus ?? new UpdateProspectStatusUseCase({ prospects: this.prospects });
    this.savePlan = savePlan ?? new SaveOraPlanUseCase({ plans: new MongoOraPlanStore() });
    this.mail = mail;
    this.sms = sms ?? buildSmsSender(env.sms);
    this.partners = partners;
    this.handoffs = handoffs;
    this.messages = messages;
    this.submitTicket = submitTicket;
  }

  async prospectFor(partnerId, prospectId) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(prospectId ?? ''))) {
      throw new ValidationException('Invalid prospect');
    }
    const prospect = await this.prospects.findById(prospectId);
    if (!prospect) throw new NotFoundException('Prospect not found');
    if (String(prospect.partnerId) !== String(partnerId)) {
      throw new ForbiddenException('This prospect is not in your pipeline');
    }
    return prospect;
  }

  requireOpenPipeline(prospect) {
    const stage = prospect?.status?.stage;
    if (stage === 'Closed' || stage === 'Converted' || prospect?.status?.status === 'Closed') {
      throw new ForbiddenException('This prospect is no longer in an open pipeline stage.');
    }
  }

  displayName(person) {
    return [person?.name, person?.surname].filter(Boolean).join(' ')
      || person?.username
      || 'A member';
  }

  async requestHandoff({ partnerId, payload = {} }) {
    const requested = ['mentor', 'support', 'auto'].includes(payload.target)
      ? payload.target
      : 'auto';
    const reason = String(payload.reason ?? '').trim().slice(0, 500);
    const member = this.partners
      ? await this.partners.findById(partnerId).catch(() => null)
      : null;
    if (!member) throw new NotFoundException('Member account not found');

    let target = requested;
    if (target === 'auto') target = member.partnerOf ? 'mentor' : 'support';

    if (target === 'mentor') {
      const preference = String(member.mentorContactPreference ?? 'in_app');
      if (member.partnerOf && preference !== 'prefer_not_now') {
        const mentorResult = await this.requestMentorHandoff({
          partnerId,
          member,
          reason,
          preference,
        });
        if (mentorResult) return mentorResult;
      }
    }
    return this.requestSupportHandoff({ partnerId, member, reason });
  }

  async requestMentorHandoff({ partnerId, member, reason, preference }) {
    if (!this.partners || !this.handoffs) return null;
    const mentorId = String(member.partnerOf ?? '');
    if (!mentorId) return null;
    const mentor = await this.partners.findById(mentorId).catch(() => null);
    if (!mentor) return null;

    const external = ['email', 'whatsapp', 'phone'].includes(preference);
    const safePreference = external && !member.mentorContactConsentAt ? 'in_app' : preference;
    const consentAt = safePreference === 'in_app' ? null : member.mentorContactConsentAt;
    await this.handoffs.ensureTask({
      partnerId,
      mentorId,
      source: member.placementCampaignId ? 'allocation' : 'referral',
      joinedAt: member.createdAt ?? new Date(),
      preference: safePreference,
      consentAt,
    });

    if (this.messages) {
      const preferenceLabel = MENTOR_CONTACT_LABELS[safePreference] ?? 'In-app chat';
      const body = [
        `${this.displayName(member)} asked for mentor support through Ora.`,
        reason ? `What they need: ${reason}` : '',
        `Preferred contact: ${preferenceLabel}.`,
      ].filter(Boolean).join('\n\n');
      await this.messages.create({
        senderId: String(partnerId),
        recipientId: mentorId,
        kind: 'direct',
        title: 'Mentor support requested',
        body: body.slice(0, 2000),
      });
    }

    return {
      type: 'request_handoff',
      target: 'mentor',
      mentorId,
      mentorName: this.displayName(mentor),
      preference: safePreference,
      consentAdjusted: safePreference !== preference,
    };
  }

  async requestSupportHandoff({ partnerId, member, reason }) {
    if (!this.submitTicket) {
      throw new ValidationException('Support handoff is not configured');
    }
    const description = [
      `Ora handoff request from ${this.displayName(member)}.`,
      reason ? `What they need: ${reason}` : '',
      `Account state: ${member.accountState ?? 'member'}`,
      `KYC: ${member.kycStatus ?? 'not_started'}`,
    ].filter(Boolean).join('\n');
    const ticket = await this.submitTicket.execute({
      subject: 'Ora handoff request',
      description,
      date: new Date(),
      category: 'Ora handoff',
      priority: 'normal',
      comment: 'Requested through Ora chat',
      partnerId: String(partnerId),
    });
    return {
      type: 'request_handoff',
      target: 'support',
      ticketId: String(ticket?.id ?? ticket?._id ?? ''),
    };
  }

  async execute({ partnerId, action }) {
    const payload = action?.payload ?? {};
    switch (action?.type) {
      case 'schedule_followup': {
        const prospect = await this.prospectFor(partnerId, payload.prospectId);
        this.requireOpenPipeline(prospect);
        const followUpDate = asDate(payload.followUpDate, 'follow-up date');
        const followUpAction = String(payload.followUpAction ?? 'Follow up').trim().slice(0, 500);
        await this.logCommunication.execute({
          prospectId: payload.prospectId,
          type: 'call',
          interestLevel: 'warm',
          description: String(payload.description ?? 'Follow-up scheduled by Ora after partner approval.').slice(0, 5000),
          followUpAction,
          followUpDate,
          createdBy: String(partnerId),
          createdByName: 'Ora',
        });
        return {
          type: 'schedule_followup',
          prospectId: String(prospect.id ?? prospect._id),
          followUpDate: followUpDate.toISOString(),
          followUpAction,
        };
      }
      case 'advance_stage': {
        const prospect = await this.prospectFor(partnerId, payload.prospectId);
        const stage = String(payload.stage ?? '');
        if (!STAGES.includes(stage)) throw new ValidationException('Invalid pipeline stage');
        const updated = await this.updateStatus.execute({
          prospectId: String(prospect.id ?? prospect._id),
          status: { stage, by: String(partnerId), byName: 'Ora' },
        });
        return {
          type: 'advance_stage',
          prospectId: String(updated?.id ?? updated?._id ?? payload.prospectId),
          stage,
        };
      }
      case 'send_followup': {
        const prospect = await this.prospectFor(partnerId, payload.prospectId);
        this.requireOpenPipeline(prospect);
        if (prospect.consentToContact !== true) {
          throw new ForbiddenException('This prospect has not consented to contact.');
        }
        const phone = String(prospect.prospectPhone ?? '').trim();
        const email = String(prospect.prospectEmail ?? '').trim();
        const requested = payload.channel === 'email' ? 'email' : payload.channel === 'sms' ? 'sms' : null;
        const channel = requested === 'email' && email
          ? 'email'
          : requested === 'sms' && phone
            ? 'sms'
            : phone
              ? 'sms'
              : email
                ? 'email'
                : null;
        if (!channel) throw new ValidationException('This prospect has no usable phone number or email.');
        const body = String(payload.body ?? '').trim().slice(0, 2000);
        if (body.length < 3) throw new ValidationException('Message body is required.');
        const subject = String(payload.subject ?? 'Following up').trim().slice(0, 120) || 'Following up';
        const recentlySent = (prospect.communications ?? []).some((row) => {
          if (!String(row?.description ?? '').startsWith('Ora-approved')) return false;
          const at = new Date(row?.date ?? 0).getTime();
          return Number.isFinite(at) && Date.now() - at < 6 * 3600000;
        });
        if (recentlySent) {
          throw new ValidationException('A message was sent to this prospect in the last 6 hours. Give them time to reply.');
        }

        if (channel === 'sms') {
          const sent = await this.sms.send({
            to: phone,
            title: 'MarketSpase follow-up',
            body,
          });
          if (sent?.logged) throw new ValidationException('SMS is not configured — ask support to enable it before sending.');
        } else {
          const sent = await this.mail(email, subject, body, { plain: true });
          if (!sent?.sent) throw new ValidationException(sent?.error || 'Email could not be sent.');
        }

        await this.logCommunication.execute({
          prospectId: String(prospect.id ?? prospect._id),
          type: channel === 'email' ? 'email' : 'text',
          interestLevel: 'warm',
          description: `Ora-approved ${channel} follow-up: ${body}`.slice(0, 5000),
          followUpAction: 'Await reply',
          createdBy: String(partnerId),
          createdByName: 'Ora',
        });
        return {
          type: 'send_followup',
          prospectId: String(prospect.id ?? prospect._id),
          channel,
          subject,
          body,
          sent: true,
        };
      }
      case 'save_daily_plan': {
        const plan = await this.savePlan.execute({ partnerId, items: payload.items, source: 'ora' });
        return {
          type: 'save_daily_plan',
          dateKey: plan.dateKey,
          items: plan.items,
        };
      }
      case 'request_handoff':
        return this.requestHandoff({ partnerId, payload });
      case 'open_page':
        return { type: 'open_page', link: action.link ?? null };
      default:
        throw new ValidationException('Unsupported Ora action');
    }
  }
}
