/**
 * Contracts for the community slice. Visibility derives from the network
 * (team = author's downline) and the ladder (leadership = ECL and above).
 */
export class CommunityStore {
  async createPost(data) { throw new Error('Not implemented'); }
  async findPostById(id) { throw new Error('Not implemented'); }
  async findCommentById(id) { throw new Error('Not implemented'); }
  async searchDirectory(query, limit) { throw new Error('Not implemented'); }
  async findUsername(partnerId) { throw new Error('Not implemented'); }
  async findPartnersByUsernames(handles) { throw new Error('Not implemented'); }
  async findMentionsOf(username, since, limit) { throw new Error('Not implemented'); }
  async recentCandidates(before, limit, excludeIds) { throw new Error('Not implemented'); }
  async setPinned(id, pinned) { throw new Error('Not implemented'); }
  async toggleLike(targetType, targetId, partnerId) { throw new Error('Not implemented'); }
  async likeCounts(targetType, targetIds) { throw new Error('Not implemented'); }
  async likedByMe(targetType, targetIds, partnerId) { throw new Error('Not implemented'); }
  async addComment(data) { throw new Error('Not implemented'); }
  async listComments(postId, limit) { throw new Error('Not implemented'); }
  async commentCounts(postIds) { throw new Error('Not implemented'); }
  async toggleSave(partnerId, postId) { throw new Error('Not implemented'); }
  async savedByMe(postIds, partnerId) { throw new Error('Not implemented'); }
  async savedCounts(postIds) { throw new Error('Not implemented'); }
  async report(partnerId, postId, reason) { throw new Error('Not implemented'); }
  async reportedByMe(partnerId) { throw new Error('Not implemented'); }
  async authorLabels(ids) { throw new Error('Not implemented'); }
  async engagementSince(since) { throw new Error('Not implemented'); }
  /** Posts authored since `since` — leadership signal. */
  async countPostsByAuthorSince(authorId, since) { throw new Error('Not implemented'); }
}
