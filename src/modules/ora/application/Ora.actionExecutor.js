import { ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { hasAutomationConsent } from '../domain/Ora.consent.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { UpdateProspectStatusUseCase } from '../../crm/application/Prospect.commands.js';
import { LogCommunicationUseCase } from '../../crm/application/Prospect.communications.js';
import { SendBulkEmailUseCase, SendBulkSmsUseCase } from '../../outreach/application/Outreach.usecases.js';
import { outreachDeps, outreachSms } from '../../outreach/infrastructure/Outreach.store.js';
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
    sendSms,
    sendEmail,
    logCommunication,
    updateStatus,
    smsEnv,
  } = {}) {
    const stores = outreachDeps();
    const link = outreachSms({ smsEnv: smsEnv ?? env.sms });
    this.prospects = prospects ?? new MongoProspectRepository();
    this.sendSms = sendSms ?? new SendBulkSmsUseCase({
      ...stores,
      sms: link.sms,
      smsEnabled: link.smsEnabled,
    });
    this.sendEmail = sendEmail ?? new SendBulkEmailUseCase({
      partners: stores.partners,
      records: stores.emailRecords,
    });
    this.logCommunication = logCommunication ?? new LogCommunicationUseCase({ prospects: this.prospects });
    this.updateStatus = updateStatus ?? new UpdateProspectStatusUseCase({ prospects: this.prospects });
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

  requireConsent(prospect) {
    if (!hasAutomationConsent(prospect)) {
      throw new ForbiddenException(
        'This prospect has not consented to automated contact. Open the record to follow up manually.',
      );
    }
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
      case 'send_sms': {
        const prospect = await this.prospectFor(partnerId, payload.prospectId);
        this.requireConsent(prospect);
        this.requireOpenPipeline(prospect);
        const phone = String(prospect.prospectPhone ?? '').trim();
        if (!phone) throw new ValidationException('This prospect has no phone number');
        const body = String(payload.body ?? '').trim();
        if (!body) throw new ValidationException('The SMS draft is empty');
        const result = await this.sendSms.execute({ partnerId, to: [phone], body });
        await this.logCommunication.execute({
          prospectId: payload.prospectId,
          type: 'text',
          interestLevel: 'warm',
          description: 'SMS sent by Ora after partner approval.',
          createdBy: String(partnerId),
          createdByName: 'Ora',
        }).catch(() => null);
        return {
          type: 'send_sms',
          sent: result.sent,
          total: result.total,
          cost: result.cost,
          status: result.status,
        };
      }
      case 'send_email': {
        const prospect = await this.prospectFor(partnerId, payload.prospectId);
        this.requireConsent(prospect);
        this.requireOpenPipeline(prospect);
        const email = String(prospect.prospectEmail ?? '').trim();
        if (!email) throw new ValidationException('This prospect has no email address');
        const subject = String(payload.subject ?? '').trim();
        const body = String(payload.body ?? '').trim();
        if (!subject || !body) throw new ValidationException('The email draft is incomplete');
        const result = await this.sendEmail.execute({
          partnerId,
          to: [email],
          subject,
          body,
        });
        await this.logCommunication.execute({
          prospectId: payload.prospectId,
          type: 'email',
          interestLevel: 'warm',
          description: 'Email sent by Ora after partner approval.',
          createdBy: String(partnerId),
          createdByName: 'Ora',
        }).catch(() => null);
        return {
          type: 'send_email',
          sent: result.sent,
          total: result.total,
          status: result.status,
        };
      }
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
      case 'open_page':
        return { type: 'open_page', link: action.link ?? null };
      default:
        throw new ValidationException('Unsupported Ora action');
    }
  }
}
