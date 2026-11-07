/**
 * Ora daily plan — small, safe and partner-scoped.
 *
 * A plan has 1-3 focus items for today (Africa/Lagos). Items are deliberately
 * short: a title, an optional detail and an optional link to a known platform
 * page. Links are validated against the capability map, so a model or a
 * manual edit can never put an arbitrary URL in front of a member.
 */
import { ValidationException } from '../../../shared/domain/AppError.js';
import { capabilityForPage } from './Ora.capabilities.js';

export const PLAN_MAX_ITEMS = 3;
export const PLAN_TITLE_MAX = 100;
export const PLAN_DETAIL_MAX = 240;
export const PLAN_LINK_MAX = 200;

const DATE_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Stable YYYY-MM-DD key in the platform's operating timezone. */
export const lagosDateKey = (now = new Date()) => {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return lagosDateKey(new Date());
  const parts = DATE_PARTS.formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Normalize plan items. Invalid or duplicate items are dropped; a strict
 * call throws when nothing usable remains so an approval cannot save an
 * empty plan.
 */
export const normalizePlanItems = (items, { strict = true } = {}) => {
  const rows = Array.isArray(items) ? items : [];
  const out = [];
  const seen = new Set();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const title = clean(row.title, PLAN_TITLE_MAX);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const detail = clean(row.detail, PLAN_DETAIL_MAX);
    const requestedLink = clean(row.link, PLAN_LINK_MAX);
    const link = requestedLink && capabilityForPage(requestedLink) ? requestedLink : '';
    out.push({
      title,
      ...(detail ? { detail } : {}),
      ...(link ? { link } : {}),
    });
    if (out.length >= PLAN_MAX_ITEMS) break;
  }

  if (strict && out.length === 0) throw new ValidationException('Add at least one plan item');
  return out;
};

/**
 * Parse a model-provided draft into plan items. Accepts a JSON array (or an
 * object with `items`) and falls back to one item per bullet/line. Invalid
 * links are dropped rather than failing the whole proposal.
 */
export const parsePlanDraft = (draft) => {
  const raw = String(draft ?? '').trim();
  if (!raw) return [];

  let rows = null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) rows = parsed;
    else if (parsed && Array.isArray(parsed.items)) rows = parsed.items;
  } catch {
    // Fall through to line parsing for friendly plain-text drafts.
  }

  if (!rows) {
    rows = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
      .map((title) => ({ title }));
  }

  return normalizePlanItems(rows, { strict: false });
};

/**
 * Last-resort extraction when the model proposes `opp:plan:today` but forgets
 * the `draft` field. Models usually describe the same plan as a short
 * numbered/bulleted list in prose; keep the approval card honest by using it.
 */
export const planDraftFromReply = (reply) => {
  const rows = [];
  for (const line of String(reply ?? '').split(/\r?\n/)) {
    const match = /^\s*(?:\d+[.)]|[-*])\s+(.+)$/.exec(line);
    if (!match) continue;
    const text = match[1].replace(/\*\*/g, '').trim();
    if (!text) continue;

    let title = text;
    let detail = '';
    const split = text.match(/^(.{3,100}?)\s+[—–-]\s+(.+)$/);
    if (split) {
      title = split[1].trim();
      detail = split[2].trim();
    } else {
      const colon = text.indexOf(': ');
      if (colon > 2 && colon <= 100) {
        title = text.slice(0, colon).trim();
        detail = text.slice(colon + 2).trim();
      }
    }
    rows.push({ title, ...(detail ? { detail } : {}) });
    if (rows.length >= PLAN_MAX_ITEMS) break;
  }
  return normalizePlanItems(rows, { strict: false });
};

export default normalizePlanItems;
