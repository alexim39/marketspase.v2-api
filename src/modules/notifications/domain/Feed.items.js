/**
 * Unified feed item. `id` is stable across reads (derived from source data)
 * so read-state persists; `at` drives urgent-first, newest-first sorting.
 */
export const NOTIFICATION_KINDS = ['followup', 'inactive', 'conversion', 'release', 'mention'];

/**
 * @param {object} p
 * @returns {{id,kind,urgency,title,body,icon,tag,link,at}}
 */
export const feedItem = (p) => ({
  id: String(p.id),
  kind: p.kind,
  urgency: p.urgency === true,
  title: String(p.title ?? ''),
  body: String(p.body ?? ''),
  icon: String(p.icon ?? 'notifications'),
  tag: String(p.tag ?? ''),
  link: p.link ?? null,
  at: p.at instanceof Date ? p.at.toISOString() : new Date(p.at ?? Date.now()).toISOString(),
});

const cap = (s, n = 60) => {
  const v = String(s ?? '').trim();
  return v || 'Unnamed';
};

const daysSince = (date, now) => Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));

/**
 * Inactivity rule (new — the legacy util never covered it):
 * open prospect with no open communication in 14+ days (or never contacted
 * within 7 days of creation).
 */
export function buildInactivityAlerts(prospects, now = new Date()) {
  const items = [];
  for (const p of prospects ?? []) {
    if (p.status?.status === 'Closed' || p.status?.stage === 'Converted' || p.status?.stage === 'Closed') continue;
    const fullName = cap(`${p.prospectName ?? ''} ${p.prospectSurname ?? ''}`.trim());
    const openComms = (p.communications ?? []).filter((c) => c.status !== 'Closed');
    const last = openComms[openComms.length - 1];
    if (last?.date) {
      const days = daysSince(last.date, now);
      if (days >= 14) {
        items.push(feedItem({
          id: `inactive:${p.id ?? p._id}`,
          kind: 'inactive',
          urgency: days >= 30,
          title: `Reconnect with ${fullName}`,
          body: `No contact in ${days} day(s)`,
          icon: 'history',
          tag: 'Inactive lead',
          link: `/dashboard/prospects/detail/${p.id ?? p._id}`,
          at: last.date,
        }));
      }
    } else if (p.createdAt) {
      const days = daysSince(p.createdAt, now);
      if (days >= 7) {
        items.push(feedItem({
          id: `inactive:${p.id ?? p._id}`,
          kind: 'inactive',
          urgency: days >= 21,
          title: `First contact overdue: ${fullName}`,
          body: `Added ${days} day(s) ago, never contacted`,
          icon: 'phone_missed',
          tag: 'Needs first contact',
          link: `/dashboard/prospects/detail/${p.id ?? p._id}`,
          at: p.createdAt,
        }));
      }
    }
  }
  return items;
}

/** Recent conversions (stage flipped within lookback days). */
export function buildConversionAlerts(prospects, { lookbackDays = 30, now = new Date() } = {}) {
  const items = [];
  for (const p of prospects ?? []) {
    if (p.status?.stage !== 'Converted' || !p.updatedAt) continue;
    if (daysSince(p.updatedAt, now) > lookbackDays) continue;
    const fullName = cap(`${p.prospectName ?? ''} ${p.prospectSurname ?? ''}`.trim());
    items.push(feedItem({
      id: `conversion:${p.id ?? p._id}`,
      kind: 'conversion',
      urgency: false,
      title: `${fullName} converted`,
      body: 'Share the enrollment code to complete signup',
      icon: 'celebration',
      tag: 'New partner pipeline',
      link: `/dashboard/prospects/pipeline`,
      at: p.updatedAt,
    }));
  }
  return items;
}

/**
 * @mention alerts — someone tagged the viewer in a post or comment.
 * Input rows carry `authorName`; ids are stable per source row so
 * read-state persists across reads.
 */
export function buildMentionAlerts(mentions, { now = new Date() } = {}) {
  const items = [];
  for (const m of mentions ?? []) {
    const excerpt = cap(m.excerpt ?? '', 120);
    items.push(feedItem({
      id: `mention:${m.sourceType}:${m.sourceId}`,
      kind: 'mention',
      urgency: false,
      title: `${cap(m.authorName ?? 'Someone')} mentioned you`,
      body: m.sourceType === 'comment' ? `Replied: ${excerpt}` : excerpt,
      icon: 'alternate_email',
      tag: 'Mention',
      link: '/dashboard/community',
      at: m.createdAt ?? now,
    }));
  }
  return items;
}

/** Recent commission releases (ledger Released entries within lookback). */
export function buildReleaseAlerts(entries, { lookbackDays = 30, now = new Date() } = {}) {
  const items = [];
  for (const e of entries ?? []) {
    const at = e.releasedAt ?? e.createdAt;
    if (!at || daysSince(at, now) > lookbackDays) continue;
    items.push(feedItem({
      id: `release:${e.id ?? e._id}`,
      kind: 'release',
      urgency: false,
      title: `Commission released: ₦${Number(e.amount ?? 0).toLocaleString()}`,
      body: `Level ${e.level ?? '?'} on ${e.buyerName || e.buyerUsername || 'a purchase'}`,
      icon: 'paid',
      tag: 'Payout',
      link: `/dashboard/settings/billing/commissions`,
      at,
    }));
  }
  return items;
}
