import { ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { UpdateProspectStatusUseCase } from '../../crm/application/Prospect.commands.js';
import { LogCommunicationUseCase } from '../../crm/application/Prospect.communications.js';
import { SaveOraPlanUseCase } from './Ora.plan.usecases.js';
import { MongoOraPlanStore } from '../infrastructure/Ora.mongo.repository.js';

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
  } = {}) {
    this.prospects = prospects ?? new MongoProspectRepository();
    this.logCommunication = logCommunication ?? new LogCommunicationUseCase({ prospects: this.prospects });
    this.updateStatus = updateStatus ?? new UpdateProspectStatusUseCase({ prospects: this.prospects });
    this.savePlan = savePlan ?? new SaveOraPlanUseCase({ plans: new MongoOraPlanStore() });
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
