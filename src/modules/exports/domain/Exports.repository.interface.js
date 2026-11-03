/**
 * Contracts for the exports slice. Exports are point-in-time CSV snapshots
 * over source aggregates — never cached, always session-scoped.
 */
export class RosterSource {
  async collectDownlineIds() { throw new Error('Not implemented'); }
  async findChildren() { throw new Error('Not implemented'); }
  async findNodesByIds() { throw new Error('Not implemented'); }
}
