import { ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { UpdateProspectStatusUseCase } from '../../crm/application/Prospect.commands.js';
import { LogCommunicationUseCase } from '../../crm/application/Prospect.communications.js';
import { SaveOraPlanUseCase } from './Ora.plan.usecases.js';
import { MongoOraPlanStore } from '../infrastructure/Ora.mongo.repository.js';
import { buildSmsSender } from '../../notifications/infrastructure/SmsSender.js';
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
  } = {}) {
    this.prospects = prospects ?? new MongoProspectRepository();
    this.logCommunication = logCommunication ?? new LogCommunicationUseCase({ prospects: this.prospects });
    this.updateStatus = updateStatus ?? new UpdateProspectStatusUseCase({ prospects: this.prospects });
    this.savePlan = savePlan ?? new SaveOraPlanUseCase({ plans: new MongoOraPlanStore() });
    this.mail = mail;
    this.sms = sms ?? buildSmsSender(env.sms);
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
      case 'open_page':
        return { type: 'open_page', link: action.link ?? null };
      default:
        throw new ValidationException('Unsupported Ora action');
    }
  }
}
