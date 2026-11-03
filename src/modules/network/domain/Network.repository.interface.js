/**
 * Repository contracts for the network read-model.
 * Level-by-level batch reads (no N+1, no $graphLookup version coupling).
 */
export class NetworkRepository {
  /**
   * @param {string} id
   * @returns {Promise<(any & {parentId:string|null})|null>} projected node + upline link
   */
  async findNode(id) { throw new Error('Not implemented'); }
  /**
   * @param {string[]} parentIds @param {number} limit
   * @returns {Promise<Array<any & {parentId:string}>>} projected children, each tagged with its parent
   */
  async findChildren(parentIds, limit) { throw new Error('Not implemented'); }
}
