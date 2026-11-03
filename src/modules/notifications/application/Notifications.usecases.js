import { buildProspectNotifications } from '../../crm/domain/Prospect.notifications.js';
import { buildConversionAlerts, buildInactivityAlerts, buildMentionAlerts, buildReleaseAlerts } from '../domain/Feed.items.js';

const rankUrgency = (a) => (a.urgency ? 0 : 1);
const MENTION_LOOKBACK_DAYS = 30;
const MENTION_LIMIT = 20;

/**
 * Unified feed: follow-ups (crm builder) + inactivity + conversions +
 * commission releases + @mentions, minus read items.
 * Urgent first, newest first. `community` is optional — without it the
 * feed behaves exactly as before (keeps old fakes/tests green).
 */
export class GetNotificationFeedUseCase {
  /** @param {{prospects, ledger, reads, community?}} deps */
  constructor({ prospects, ledger, reads, community }) {
    this.prospects = prospects;
    this.ledger = ledger;
    this.reads = reads;
    this.community = community ?? null;
  }

  /** Resolve mention rows with author names; never throws (feed degrades). */
  async resolveMentions(partnerId, now) {
    if (!this.community) return [];
    try {
      const username = await this.community.findUsername(partnerId);
      if (!username) return [];
      // Mentions store lowercase handles — normalize at the call site.
      const handle = String(username).toLowerCase();
      const since = new Date(now.getTime() - MENTION_LOOKBACK_DAYS * 86400000);
      const rows = await this.community.findMentionsOf(handle, since, MENTION_LIMIT);
      const fresh = rows.filter((r) => String(r.authorId) !== String(partnerId));
      if (fresh.length === 0) return [];
      const labels = await this.community.authorLabels(fresh.map((r) => r.authorId));
      return buildMentionAlerts(fresh.map((r) => ({
        ...r,
        authorName: labels[r.authorId]?.name ?? labels[r.authorId]?.username ?? null,
      })), { now });
    } catch {
      return [];
    }
  }

  async execute({ partnerId, now = new Date(), limit = 100 }) {
    const { items: list } = await this.prospects.findByPartnerId(partnerId, { limit: 500, skip: 0 });
    const [read, releases, mentions] = await Promise.all([
      this.reads.readIds(partnerId),
      this.ledger.findReleasedSince(partnerId, 30),
      this.resolveMentions(partnerId, now),
    ]);

    const all = [
      ...buildProspectNotifications(list, now).map((n) => ({
        id: `followup:${n.prospectId}:${n.communication?._id ?? n.communication?.id ?? n.tag}`,
        kind: 'followup',
        urgency: n.urgency === true,
        title: n.title,
        body: n.description ?? '',
        icon: n.icon ?? 'notifications',
        tag: n.tag ?? '',
        link: `/dashboard/prospects/detail/${n.prospectId}`,
        at: n.communication?.date ?? now.toISOString(),
      })),
      ...buildInactivityAlerts(list, now),
      ...buildConversionAlerts(list, { now }),
      ...buildReleaseAlerts(releases, { now }),
      ...mentions,
    ];

    const unread = all.filter((n) => !read.has(n.id));
    unread.sort((a, b) => rankUrgency(a) - rankUrgency(b) || new Date(b.at) - new Date(a.at));
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
    return {
      items: unread.slice(0, lim),
      total: unread.length,
      unreadCount: unread.filter((n) => n.urgency).length,
    };
  }
}

/** Persist read-state for feed item ids (idempotent). */
export class MarkNotificationsReadUseCase {
  /** @param {{reads}} deps */
  constructor({ reads }) {
    this.reads = reads;
  }

  async execute({ partnerId, ids }) {
    const clean = [...new Set((ids ?? []).map(String))].filter(Boolean).slice(0, 200);
    if (clean.length > 0) await this.reads.markRead(partnerId, clean);
    return { marked: clean.length };
  }
}
