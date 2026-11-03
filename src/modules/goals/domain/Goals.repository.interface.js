/**
 * Contracts for the goals slice. Progress numerators come from source
 * aggregates (orders, recruits, prospects, network) — goals store only
 * the target definition, never cached counters (no staleness, no fan-out).
 */
export class GoalStore {
  async create(data) { throw new Error('Not implemented'); }
  async findById(id) { throw new Error('Not implemented'); }
  async listByPartner(partnerId) { throw new Error('Not implemented'); }
  async updateById(id, patch) { throw new Error('Not implemented'); }
  async deleteById(id) { throw new Error('Not implemented'); }
}
