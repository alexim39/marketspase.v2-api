import { claimExpiry, CLAIM_WORK_HOURS, EXPIRY_WARNING_HOURS } from '../domain/LeadPool.js';
import { ReleaseProspectToPoolUseCase } from './Prospect.release.js';
import { ProspectModel } from '../infrastructure/Prospect.models.js';

/**
 * 48-hour work-or-return sweep. Runs every few minutes: warns holders
 * inside the warning window (once per claim), auto-returns idle claims
 * past the deadline (with the standard return refund — an automatic
 * return is still a return). Worked and converted leads are never
 * touched. Failures are collected per row, never thrown.
 */
export class ExpireStaleClaimsUseCase {
  /** @param {{claims, release, notify?, now?, batch?, workHours?, warningHours?}} deps */
  constructor({ claims, release, notify = null, now = null, batch = 50, workHours, warningHours } = {}) {
    Object.assign(this, {
      claims: claims ?? ProspectModel,
      release,
      notify,
      now: now ?? (() => Date.now()),
      batch: Math.min(Math.max(Number(batch) || 50, 1), 200),
      workHours: workHours ?? CLAIM_WORK_HOURS,
      warningHours: warningHours ?? EXPIRY_WARNING_HOURS,
    });
  }

  async execute() {
    const t = this.now();
    const warnCutoff = new Date(t - (this.workHours - this.warningHours) * 3600000);
    // Candidates: claimed, old enough to warn/expire. Converted rows are
    // filtered in JS (stage lives in a subdocument).
    const rows = await this.claims
      .find({ claimedAt: { $lte: warnCutoff } })
      .sort({ claimedAt: 1 })
      .limit(this.batch)
      .lean().catch(() => []);
    const result = { checked: 0, warned: 0, expired: 0, secured: 0, failed: [] };
    for (const row of rows ?? []) {
      if (row?.status?.stage === 'Converted') continue;
      result.checked += 1;
      const state = claimExpiry(row, { now: t, workHours: this.workHours });
      if (state.secured) {
        result.secured += 1;
        continue;
      }
      const holder = String(row.partnerId);
      const name = `${row.prospectName ?? ''} ${row.prospectSurname ?? ''}`.trim() || 'A lead';
      try {
        if (state.expirable) {
          await this.release.execute({ partnerId: holder, prospectId: String(row._id) });
          result.expired += 1;
          await this.notify?.({ kind: 'expired', partnerId: holder, prospectId: String(row._id), leadName: name });
        } else if (!row.claimWarningAt && state.msLeft <= this.warningHours * 3600000) {
          await this.claims.updateOne({ _id: row._id }, { $set: { claimWarningAt: new Date(t) } }).catch(() => null);
          result.warned += 1;
          await this.notify?.({
            kind: 'warning', partnerId: holder, prospectId: String(row._id), leadName: name,
            hoursLeft: Math.max(1, Math.ceil(state.msLeft / 3600000)),
          });
        }
      } catch (error) {
        result.failed.push({ id: String(row._id), error: error?.message ?? String(error) });
      }
    }
    return result;
  }
}
