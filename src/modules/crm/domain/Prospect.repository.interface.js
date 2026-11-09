/**
 * Repository contracts for the crm context (prospect aggregate).
 * Survey-coupled flows (import/move-back) stay on legacy until the
 * `insight` slice owns the Survey model — see module README note.
 */

export class ProspectRepository {
  /** @returns {Promise<any>} created domain prospect */
  async create(data) { throw new Error('Not implemented'); }
  /** @param {string} id */
  async findById(id) { throw new Error('Not implemented'); }
  /**
   * @param {string} partnerId
   * @param {{limit:number, skip:number}} page
   * @returns {Promise<{items:any[], total:number}>}
   */
  async findByPartnerId(partnerId, page) { throw new Error('Not implemented'); }
  /**
   * Scoped duplicate lookup — legacy checked GLOBALLY, which blocked
   * partner B from adding partner A's prospect. Scope is the fix;
   * the `prospectPhone unique` index remains as a backstop (→ 409).
   */
  async findDuplicate(partnerId, { phone, email }) { throw new Error('Not implemented'); }
  /** Partial update — only defined keys are $set (never wholesale replace). */
  async updateFields(id, patch) { throw new Error('Not implemented'); }
  /** Status overlay via dotted $set — preserves Open/Closed flag + untouched dates. */
  async updateStatus(id, overlay) { throw new Error('Not implemented'); }
  /** @returns {Promise<any|null>} updated prospect or null */
  async pushCommunication(id, communication) { throw new Error('Not implemented'); }
  /** Earliest prospect per partner: {partnerId: isoDate} (one aggregate). */
  async firstProspectDates(ids) { throw new Error('Not implemented'); }
  async countTouchedSince(partnerId, since) { throw new Error('Not implemented'); }
  /** @returns {Promise<{prospect:any|null, removed:boolean}>} */
  async pullCommunication(prospectId, communicationId) { throw new Error('Not implemented'); }
  /** @returns {Promise<boolean>} true when something was deleted */
  async deleteById(id) { throw new Error('Not implemented'); }
}

export class PartnerLookup {
  /** Minimal read-only coupling for 404-on-unknown-partner list semantics. */
  async exists(partnerId) { throw new Error('Not implemented'); }
}
