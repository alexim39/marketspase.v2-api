/**
 * Contracts for the notifications slice.
 * The feed DERIVES everything from source aggregates (prospects, ledger) —
 * no event bus, no cross-slice writes. Only read-state is stored.
 */
export class NotificationStore {
  /** @param {string} partnerId @returns {Promise<Set<string>>} read item ids */
  async readIds(partnerId) { throw new Error('Not implemented'); }
  /** @param {string} partnerId @param {string[]} ids */
  async markRead(partnerId, ids) { throw new Error('Not implemented'); }
}

/**
 * Stored (event-sourced) notifications + preferences. The derived feed
 * stays untouched — this store powers archive/delete/history/search,
 * which derivation cannot provide.
 */
export class StoredNotificationStore {
  async create(data) { throw new Error('Not implemented'); }
  async findById(id) { throw new Error('Not implemented'); }
  async findByKey(recipientId, key) { throw new Error('Not implemented'); }
  async hasBriefForDay(recipientId, day) { throw new Error('Not implemented'); }
  async list(partnerId, { unreadOnly, search, cursor, limit }) { throw new Error('Not implemented'); }
  async markRead(partnerId, id) { throw new Error('Not implemented'); }
  async markAllRead(partnerId) { throw new Error('Not implemented'); }
  async archive(partnerId, id) { throw new Error('Not implemented'); }
  async archiveAll(partnerId) { throw new Error('Not implemented'); }
  async remove(partnerId, id) { throw new Error('Not implemented'); }
  async unreadCount(partnerId) { throw new Error('Not implemented'); }
  async getPreferences(partnerId) { throw new Error('Not implemented'); }
  async savePreferences(partnerId, prefs) { throw new Error('Not implemented'); }
  async listDigestSubscribers(digest, { cursor, limit }) { throw new Error('Not implemented'); }
  async unreadSince(partnerId, since, limit) { throw new Error('Not implemented'); }
  async stampDigest(partnerId, kind, at) { throw new Error('Not implemented'); }
  async saveSubscription(partnerId, sub) { throw new Error('Not implemented'); }
  async removeSubscription(partnerId, endpoint) { throw new Error('Not implemented'); }
  async pruneSubscription(partnerId, endpoint) { throw new Error('Not implemented'); }
  async listSubscriptions(partnerId) { throw new Error('Not implemented'); }
  async markUnread(partnerId, id) { throw new Error('Not implemented'); }
  async recordClick(partnerId, id) { throw new Error('Not implemented'); }
  async stampChannels(id, stamp) { throw new Error('Not implemented'); }
  async deleteAll(partnerId) { throw new Error('Not implemented'); }
  async engagementStats(partnerId, since) { throw new Error('Not implemented'); }
}
