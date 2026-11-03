import { NotFoundException } from '../../../shared/domain/AppError.js';
import { destroyPostMedia } from './Community.usecases.js';

/** GET (admin) — reported-posts queue passthrough. */
export class ListReportedUseCase {
  /** @param {{community}} deps */
  constructor({ community }) {
    this.community = community;
  }

  async execute({ limit = 25, skip = 0 } = {}) {
    return this.community.reportedQueue({ limit, skip });
  }
}

/**
 * Admin moderation decision on a reported post.
 * - remove: deletes post + comments/likes/saves/reports (cascade reuse).
 * - dismiss: clears the reports, keeps the post.
 */
export class ModeratePostUseCase {
  /** @param {{community, media?}} deps (media optional — destroys attachments on remove) */
  constructor({ community, media = null }) {
    this.community = community;
    this.media = media;
  }

  async execute({ postId, decision }) {
    if (!['remove', 'dismiss'].includes(decision)) {
      const { ValidationException } = await import('../../../shared/domain/AppError.js');
      throw new ValidationException("Unknown decision (expected 'remove' or 'dismiss')");
    }
    const post = await this.community.findPostById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (decision === 'remove') {
      await this.community.deletePostCascade(postId);
      await destroyPostMedia(this.media, post.attachments).catch(() => null);
      return { decision, postId: String(postId) };
    }
    const { dismissed } = await this.community.dismissReports(postId);
    return { decision, postId: String(postId), dismissed };
  }
}
