/**
 * Repository contracts for the network read-model.
 * Level-by-level batch reads (no N+1, no $graphLookup version coupling).
 */
export class NetworkRepository {
  /**
   * @param {string} id @param {'growth'|'referral'|'all'} [chain]
   * @returns {Promise<(any & {parentId:string|null})|null>} projected node + chain-specific upline link
   */
  async findNode(id, chain = 'all') { void chain; throw new Error('Not implemented'); }
  /**
   * @param {string[]} parentIds @param {number} limit @param {'growth'|'referral'|'all'} [chain]
   * @returns {Promise<Array<any & {parentId:string}>>} projected children, each tagged with its parent
   */
  async findChildren(parentIds, limit, chain = 'all') { void parentIds; void limit; void chain; throw new Error('Not implemented'); }
}
