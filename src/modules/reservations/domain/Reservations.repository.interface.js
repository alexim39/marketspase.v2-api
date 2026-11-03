/**
 * Contracts for the reservations slice (referral-code lifecycle).
 * Session identity is the referrer — callers never supply partnerId.
 * partnerId below is the CREDIT HOLDER (beneficiary); recordedBy carries
 * the submitting actor for on-behalf records (null = self-recorded).
 */
export class ReservationStore {
  async findByCode(code) { throw new Error('Not implemented'); }
  async record({ code, partnerId, prospectId, recordedBy }) { throw new Error('Not implemented'); }
  async markUsed(code, opts) { throw new Error('Not implemented'); }
  async listByPartner(partnerId, limit) { throw new Error('Not implemented'); }
}
