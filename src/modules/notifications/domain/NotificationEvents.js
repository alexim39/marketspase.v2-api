/**
 * Notification event catalog — the contract between business modules
 * (emitters) and the notification slice (subscribers).
 * Payloads are plain data (ids + text); subscribers resolve everything
 * else so events stay small and serializable for a future broker.
 */

export const NOTIFICATION_EVENTS = {
  /** A community post/comment carrying @mentions was created. */
  MENTION_CREATED: 'community.mention.created',
  /**
   * Generic send request for future producers (jobs, promotions…).
   * Prefer this over calling NotifyUseCase directly: routing, prefs
   * and channel receipts live in exactly one place.
   */
  SEND_REQUESTED: 'notification.send.requested',
};

/** @param {{authorId, sourceType, sourceId, handles, text}} input */
export const mentionCreated = ({ authorId, sourceType, sourceId, handles = [], text = '' }) => ({
  type: NOTIFICATION_EVENTS.MENTION_CREATED,
  authorId: String(authorId),
  sourceType,
  sourceId: String(sourceId),
  handles: [...new Set((handles ?? []).map((h) => String(h ?? '').toLowerCase()))].filter(Boolean),
  text: String(text ?? ''),
});
