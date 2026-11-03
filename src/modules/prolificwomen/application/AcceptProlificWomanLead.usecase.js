import { ConflictException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { ProspectModel } from '../../crm/infrastructure/Prospect.models.js';
import { normalizePhone } from '../../crm/domain/Prospect.entity.js';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

const notesFor = (lead) =>
  [
    'Prolific Women website application',
    `Location: ${lead.location}`,
    `Mentorship: ${lead.readyToBeMentored === 'yes' ? 'Ready now' : 'Exploring'}`,
    `Head office: ${lead.headOfficeInvite === 'yes' ? 'Visit requested' : 'Online'}`,
    `Availability: ${lead.availability === 'weekdays' ? 'Weekdays' : 'Weekends'}`,
  ]
    .join('\n')
    .slice(0, 2000);

export class AcceptProlificWomanLeadUseCase {
  constructor({ leads, prospects = ProspectModel } = {}) {
    this.leads = leads;
    this.prospects = prospects;
  }

  async execute({ partnerId, leadId }) {
    if (!OBJECT_ID_RE.test(String(leadId ?? ''))) {
      throw new ValidationException('Invalid lead id');
    }

    const lead = await this.leads.findById(leadId);
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.acceptedAt) throw new ConflictException('Lead has already been accepted');

    const phone = normalizePhone(lead.phone);
    const duplicateQuery = this.prospects.findOne({
      partnerId,
      prospectPhone: phone,
    });
    const duplicate = duplicateQuery?.lean ? await duplicateQuery.lean() : await duplicateQuery;
    if (duplicate) throw new ConflictException('This lead is already in your pipeline');

    const claimed = await this.leads.claimForAccept({ id: leadId, partnerId });
    if (!claimed) throw new ConflictException('Lead has already been accepted');

    let created;
    try {
      created = await this.prospects.create({
        prospectName: lead.name,
        prospectSurname: '',
        prospectPhone: phone,
        prospectSource: 'Prolific Women',
        partnerId,
        consentToContact: true,
        notes: notesFor(lead),
        prolificWomanLeadId: lead.id,
      });
    } catch (error) {
      await this.leads.releaseClaim(leadId).catch(() => null);
      throw error;
    }

    const prospectId = String(created._id ?? created.id);
    await this.leads.setProspectId(leadId, prospectId).catch(() => null);
    return { prospectId };
  }
}
