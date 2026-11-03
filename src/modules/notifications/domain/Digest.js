import { CATEGORY_LABELS } from './StoredNotifications.js';

/**
 * Email digest content — pure grouping of unread stored items.
 * The job decides *who* and *when*; this module decides *what*:
 * one section per category (label, count, top titles), newest first,
 * capped so the email stays scannable.
 */

export const DIGEST_KINDS = ['daily', 'weekly'];
export const MAX_DIGEST_TITLES = 10;

/** Server-local midnight today. */
export const startOfToday = (now = new Date()) => {
  const d = now instanceof Date ? now : new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/** Server-local midnight of the most recent Monday (today if Monday). */
export const startOfWeek = (now = new Date()) => {
  const d = now instanceof Date ? now : new Date(now);
  const mondayIndex = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - mondayIndex);
  return monday;
};

/** Weekly digests go out on Mondays; daily digests every day. */
export const isDigestDay = (kind, now = new Date()) => {
  if (kind === 'daily') return true;
  if (kind === 'weekly') return (now instanceof Date ? now : new Date(now)).getDay() === 1;
  return false;
};

/**
 * @param {{kind, items}} input (items newest-first, already windowed)
 * @returns null when there is nothing to send, else {subject, total, groups}.
 */
export const buildDigest = ({ kind = 'daily', items = [] } = {}) => {
  const rows = (items ?? []).filter(Boolean);
  if (rows.length === 0) return null;
  const byCategory = new Map();
  for (const item of rows) {
    const cat = String(item.category ?? 'system');
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(item);
  }
  const groups = [...byCategory.entries()].map(([category, list]) => ({
    category,
    label: CATEGORY_LABELS[category] ?? category,
    count: list.length,
    titles: list.slice(0, MAX_DIGEST_TITLES).map((i) => String(i.title ?? '(untitled)')),
    more: Math.max(0, list.length - MAX_DIGEST_TITLES),
  }));
  const total = rows.length;
  const subject = kind === 'weekly'
    ? `Your week in Diamond Project — ${total} unread ${total === 1 ? 'update' : 'updates'}`
    : `Your daily digest — ${total} unread ${total === 1 ? 'update' : 'updates'}`;
  return { subject, total, groups };
};
