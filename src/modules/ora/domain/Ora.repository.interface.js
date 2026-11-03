/**
 * Contracts for the ora slice (AI assistant).
 * The LLM client is a port — tests inject fakes, production wires DeepSeek.
 * Only conversation history is stored; the model itself is stateless and
 * receives a bounded snapshot + recent window on every call.
 */
export class OraConversationStore {
  async create(partnerId, title) { throw new Error('Not implemented'); }
  async findById(id) { throw new Error('Not implemented'); }
  async listByPartner(partnerId, { limit, q } = {}) { throw new Error('Not implemented'); }
  async appendMessage(id, message) { throw new Error('Not implemented'); }
  async setPinned(partnerId, id, pinned) { throw new Error('Not implemented'); }
  async remove(partnerId, id) { throw new Error('Not implemented'); }
}

export class OraAnalyticsStore {
  async recordEvent(event) { throw new Error('Not implemented'); }
  async eventsFor(partnerId, since) { throw new Error('Not implemented'); }
}

export class OraClient {
  /** @returns {Promise<string>} assistant reply text */
  async complete({ system, messages }) { throw new Error('Not implemented'); }
}
