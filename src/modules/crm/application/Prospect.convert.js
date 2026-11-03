import { ConflictException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { EnrollmentCodePattern } from '../interface/Prospect.validator.js';

/**
 * Convert prospect → partner enrollment (Phase A).
 * Records the upline-provided, business-issued reservation code
 * (NV/NI/NR + 6 digits or 247… path — the same shape the signup form
 * requires) as Approved, owned by the prospect's upline, and stamps the
 * prospect Converted. The prospect then signs up with that code via
 * POST /v1/auth/signup, which links `partnerOf` automatically.
 * Idempotent-safe: already-converted prospects get 409, never a second code.
 */
export class ConvertProspectToPartnerUseCase {
  /** @param {{prospects, reservations}} deps */
  constructor({ prospects, reservations }) {
    this.prospects = prospects;
    this.reservations = reservations;
  }

  async execute({ prospectId, code, by, byName }) {
    const prospect = await this.prospects.findById(prospectId);
    if (!prospect) throw new NotFoundException('Prospect not found');
    if (prospect.status?.stage === 'Converted') {
      throw new ConflictException('Prospect has already been converted');
    }

    const clean = String(code ?? '').trim();
    if (!clean) throw new ValidationException('Reservation code is required');
    if (!EnrollmentCodePattern.test(clean)) {
      throw new ValidationException('Reservation code format not recognised');
    }
    if (await this.reservations.existsByCode(clean)) {
      throw new ConflictException('This reservation code is already recorded');
    }

    let enrollment;
    try {
      enrollment = await this.reservations.createApproved({
        code: clean,
        partnerId: prospect.partnerId,
        prospectId: prospect.id ?? prospectId,
      });
    } catch (err) {
      // Unique-index backstop for the exists-then-create race.
      if (err?.code === 11000) throw new ConflictException('This reservation code is already recorded');
      throw err;
    }

    const updated = await this.prospects.updateStatus(prospectId, {
      name: 'Converted',
      stage: 'Converted',
    }, {
      ...(by && String(by).trim() !== '' ? { by: String(by).trim().slice(0, 40) } : {}),
      ...(byName && String(byName).trim() !== '' ? { byName: String(byName).trim().slice(0, 120) } : {}),
    });

    return { code: enrollment.code, prospect: updated };
  }
}
