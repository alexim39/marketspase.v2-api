/**
 * Ora action cards — pure contract, unit-testable without Mongo.
 * The model may append ONE fenced block to its reply:
 *
 * ```actions
 * [{"label":"Open Pipeline","link":"/dashboard/prospects/pipeline"}]
 * ```
 *
 * The backend strips the block, validates every link against the
 * allowlist (prefix match, so detail/:id deep links pass) and returns
 * `{text, actions}`. Anything off-allowlist is dropped, never rendered —
 * the model can never aim the UI at an arbitrary URL.
 */

export const ALLOWED_ACTION_PREFIXES = [
  '/dashboard',
  '/dashboard/prospects',
  '/dashboard/goals',
  '/dashboard/community',
  '/dashboard/network',
  '/dashboard/training',
  '/dashboard/notifications',
  '/dashboard/messages',
  '/dashboard/earnings',
  '/dashboard/insights',
  '/dashboard/progress',
];

export const MAX_ACTIONS = 3;

const isAllowedLink = (link) => {
  if (typeof link !== 'string' || !link.startsWith('/dashboard')) return false;
  if (link.includes(' ') || link.includes('\\') || link.length > 200) return false;
  if (link === '/dashboard') return true;
  return ALLOWED_ACTION_PREFIXES.filter((p) => p !== '/dashboard')
    .some((p) => link === p || link.startsWith(`${p}/`));
};

const cleanAction = (a) => {
  const label = String(a?.label ?? '').trim().slice(0, 40);
  const link = String(a?.link ?? '').trim();
  if (!label || !isAllowedLink(link)) return null;
  return { label, link };
};

/**
 * @param {string} reply raw model text (may contain one ```actions block)
 * @returns {{text, actions}} cleaned text + validated cards (max 3)
 */
export const extractActions = (reply) => {
  const raw = String(reply ?? '');
  const match = raw.match(/```actions\s*([\s\S]*?)```\s*$/);
  if (!match) return { text: raw.trim(), actions: [] };
  let parsed = [];
  try {
    const data = JSON.parse(match[1].trim());
    if (Array.isArray(data)) parsed = data;
  } catch {
    parsed = [];
  }
  const actions = [];
  for (const a of parsed) {
    const clean = cleanAction(a);
    if (clean && !actions.some((x) => x.link === clean.link)) actions.push(clean);
    if (actions.length >= MAX_ACTIONS) break;
  }
  return { text: raw.slice(0, match.index).trim(), actions };
};
