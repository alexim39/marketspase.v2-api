import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { ProspectModel } from '../infrastructure/Prospect.models.js';

/**
 * POST /v1/prospects/:prospectId/rate — 1–5 star quality vote on a worked
 * lead. Kept after the Buy Prospect pool retirement because the pipeline
 * still records lead quality after a conversion.
 */
export class RateLeadUseCase {
  constructor({ prospects } = {}) {
    this.prospects = prospects ?? ProspectModel;
  }

  async execute({ partnerId, prospectId, score, note = '' }) {
    const value = Number(score);
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      throw new ValidationException('Rating must be between 1 and 5');
    }
    const row = await this.prospects.findOneAndUpdate(
      { _id: prospectId, partnerId },
      { $set: { rating: { score: value, note: String(note ?? '').slice(0, 500), at: new Date() } } },
      { new: true },
    ).lean();
    if (!row) throw new NotFoundException('Prospect not found');
    return { prospectId: String(row._id), rating: row.rating };
  }
}
