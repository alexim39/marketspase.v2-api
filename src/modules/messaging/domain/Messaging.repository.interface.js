/**
 * Contracts for the messaging slice (Communication Center).
 * One row per recipient — read-state lives on the row (readAt), so
 * inbox, thread and unread counts are single queries, no joins.
 */
export class MessageStore {
  async create(data) { throw new Error('Not implemented'); }
  async createMany(rows) { throw new Error('Not implemented'); }
  async inbox(partnerId, limit) { throw new Error('Not implemented'); }
  async sent(partnerId, limit) { throw new Error('Not implemented'); }
  async thread(partnerId, counterpartId, limit, before) { throw new Error('Not implemented'); }
  async findById(id) { throw new Error('Not implemented'); }
  async markRead(id) { throw new Error('Not implemented'); }
  async unreadCount(partnerId) { throw new Error('Not implemented'); }
}
