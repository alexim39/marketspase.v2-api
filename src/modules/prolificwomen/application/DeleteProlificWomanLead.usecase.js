import { ConflictException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * Admin hard delete of one application row.
 * Accepted rows already live on as pipeline prospects, so they are
 * protected here (409) — delete the prospect instead. Unaccepted rows
 * (spam, tests, junk) delete outright and the decision is audited.
 */
export class DeleteProlificWomanLeadUseCase {
  constructor({ leads }) {
    if (!leads) throw new Error('DeleteProlificWomanLeadUseCase requires leads');
    this.leads = leads;
  }

  async execute({ leadId }) {
    if (!OBJECT_ID_RE.test(String(leadId ?? ''))) {
      throw new ValidationException('Invalid lead id');
    }
    const lead = await this.leads.findById(leadId);
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.acceptedAt) {
      throw new ConflictException('Lead has already been accepted into a pipeline and cannot be deleted here');
    }
    const removed = await this.leads.removeById(leadId);
    if (!removed) throw new NotFoundException('Lead not found');
    return { id: String(removed.id ?? leadId) };
  }
}
