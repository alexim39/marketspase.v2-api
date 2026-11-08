import { RANK_GROUP_EVENTS } from '../../messaging/domain/RankGroups.js';

const rankLabel = (rank) => (rank ? `${rank} Circle` : 'your circle');

/**
 * In-app notification for a real-time official group move.
 *
 * The stored item is keyed per event so a duplicate delivery cannot create
 * two rows, and links straight to the new group's conversation. No email or
 * SMS: a group move is a messaging event, not a lifecycle milestone.
 */
export class RankGroupFanoutUseCase {
  /** @param {{notify}} deps */
  constructor({ notify }) {
    this.notify = notify;
  }

  async execute(payload = {}) {
    const partnerId = String(payload.partnerId ?? '');
    const groupId = String(payload.groupId ?? '');
    if (!partnerId || !groupId) return { status: 'skipped', reason: 'incomplete' };

    const groupName = String(payload.groupName ?? '').trim() || rankLabel(payload.rank);
    const fromName = payload.fromRank ? rankLabel(payload.fromRank) : null;
    const title = fromName ? `You moved to ${groupName}` : `Welcome to ${groupName}`;
    const body = fromName
      ? `Your journey level changed, so you moved from ${fromName} to ${groupName}. Open Messages to join the conversation.`
      : `You are now a member of ${groupName}. Open Messages to meet the group and join the conversation.`;
    const at = payload.at ? String(payload.at) : new Date().toISOString();

    try {
      const row = await this.notify.execute({
        recipientId: partnerId,
        category: 'progression',
        priority: 'medium',
        title,
        body,
        icon: 'groups',
        link: `/dashboard/messages?group=${encodeURIComponent(groupId)}`,
        key: `rank-group:${groupId}:${at}`,
      });
      return {
        status: row?.deduped ? 'deduped' : 'notified',
        id: row?.id ? String(row.id) : null,
      };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }
}

/**
 * @param {{events, notify}} deps
 * @returns unsubscribe function
 */
export const subscribeRankGroupFanout = ({ events, notify }) => {
  const fanout = new RankGroupFanoutUseCase({ notify });
  return events.on(RANK_GROUP_EVENTS.CHANGED, (payload) => fanout.execute(payload));
};
