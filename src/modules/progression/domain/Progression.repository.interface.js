/**
 * Contracts for the progression slice. Levels DERIVE from signals +
 * milestones on every read; only milestones (with audit events) persist.
 */
export class ProgressionStore {
  async findByPartner(partnerId) { throw new Error('Not implemented'); }
  async upsertMilestones(partnerId, patch, event) { throw new Error('Not implemented'); }
  async setLevel(partnerId, level) { throw new Error('Not implemented'); }
  async levelsFor(partnerIds) { throw new Error('Not implemented'); }
  async requestTrainingConfirm(partnerId, key) { throw new Error('Not implemented'); }
  async confirmTraining(partnerId, key, approverId, approved) { throw new Error('Not implemented'); }
  async listPendingConfirmations(partnerIds, keys, limit) { throw new Error('Not implemented'); }
  async listConfirmationStats(partnerIds, keys) { throw new Error('Not implemented'); }
  async decisionsByApprover(approverId, since) { throw new Error('Not implemented'); }
  /** IPO stamp per partner: {partnerId: isoDate|null} (one query). */
  async trainingDates(ids) { throw new Error('Not implemented'); }
  async requestNomination(partnerId, note) { throw new Error('Not implemented'); }
  /** Counted approval — returns `{doc, duplicate}` (null doc = nothing pending). */
  async approveNomination(partnerId, approverId, required) { throw new Error('Not implemented'); }
  async rejectNomination(partnerId, decidedBy) { throw new Error('Not implemented'); }
  async listPendingNominations(partnerIds, limit) { throw new Error('Not implemented'); }
}
