import { ValidationException } from '../../../shared/domain/AppError.js';
import { normalizePhone } from '../domain/Prospect.entity.js';

/** CSV contact import — row shape accepted from parsed sheets. */
export const IMPORT_ROW_KEYS = ['name', 'surname', 'phone', 'email', 'source', 'relationship'];
export const IMPORT_MAX_ROWS = 500;

/**
 * Bulk-import parsed contact rows into one partner's pipeline.
 * Reuses CreateProspectUseCase per row (same validation + scoped
 * duplicate rules), plus in-batch phone dedupe so a sheet that lists
 * someone twice reports the second as skipped, not failed.
 * Never partial-fails: every row lands in inserted or skipped.
 */
export class ImportContactsUseCase {
  /** @param {{create}} deps (a CreateProspectUseCase) */
  constructor({ create }) {
    this.create = create;
  }

  async execute({ partnerId, rows }) {
    if (!Array.isArray(rows)) throw new ValidationException('Rows must be an array');
    if (rows.length === 0) throw new ValidationException('Nothing to import');
    if (rows.length > IMPORT_MAX_ROWS) {
      throw new ValidationException(`At most ${IMPORT_MAX_ROWS} contacts per import`);
    }
    const seenPhones = new Set();
    const skipped = [];
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const raw = rows[i] ?? {};
      const label = [raw.name, raw.surname].filter(Boolean).join(' ').trim() || `Row ${i + 1}`;
      const phone = normalizePhone(raw.phone ?? raw.prospectPhone ?? '');
      if (phone && seenPhones.has(phone)) {
        skipped.push({ index: i, name: label, reason: 'Duplicate phone within this file' });
        continue;
      }
      try {
        await this.create.execute({
          partnerId,
          prospectName: raw.name ?? raw.prospectName,
          prospectSurname: raw.surname ?? raw.prospectSurname ?? '',
          prospectPhone: raw.phone ?? raw.prospectPhone,
          prospectEmail: raw.email ?? raw.prospectEmail ?? '',
          prospectSource: raw.source ?? raw.prospectSource ?? 'Contact Import',
          relationship: raw.relationship,
        });
        if (phone) seenPhones.add(phone);
        inserted += 1;
      } catch (error) {
        skipped.push({ index: i, name: label, reason: error?.message ?? 'Invalid row' });
      }
    }
    return { inserted, skipped, total: rows.length };
  }
}
