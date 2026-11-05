import { ConflictException, NotFoundException } from '../../../shared/domain/AppError.js';
import { statusNameForStage } from '../domain/Prospect.entity.js';

/**
 * Convert prospect → partner enrollment.
 * No reservation code is required — the prospect is marked Converted and
 * signs up through open registration.
 */
export class ConvertProspectToPartnerUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) {
    this.prospects = prospects;
  }

  async execute({ prospectId, by, byName }) {
    const prospect = await this.prospects.findById(prospectId);
    if (!prospect) throw new NotFoundException('Prospect not found');
    if (prospect.status?.stage === 'Converted') {
      throw new ConflictException('Prospect has already been converted');
    }

    const updated = await this.prospects.updateStatus(prospectId, {
      name: statusNameForStage('Converted') ?? 'Partner',
      stage: 'Converted',
    }, {
      ...(by && String(by).trim() !== '' ? { by: String(by).trim().slice(0, 40) } : {}),
      ...(byName && String(byName).trim() !== '' ? { byName: String(byName).trim().slice(0, 120) } : {}),
    });

    return { code: null, prospect: updated };
  }
}
