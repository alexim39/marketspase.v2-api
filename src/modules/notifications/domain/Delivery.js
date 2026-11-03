/**
 * Delivery channel resolution + payload shaping — pure.
 * The matrix is `{inApp, email, sms, push}` per category; `push` rides
 * with the N-series defaults (off until the user opts in).
 */
import { paragraphs } from '../../../services/emailBrand.js';

export const DELIVERY_CHANNELS = ['inApp', 'email', 'sms', 'push'];

const SMS_MAX = 459; // 3 GSM segments — providers concatenate beyond this.

/** E.164-ish normalization (providers reject spaces/dashes/pluses).
 * Nigerian local format 0803… → international 234803…; anything already
 * international passes through untouched. */
export const normalizePhone = (raw) => {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const intl = /^0\d{9,10}$/.test(digits) ? `234${digits.slice(1)}` : digits;
  return intl.length >= 7 ? intl : null;
};

/** Unicode punctuation → GSM-7 lookalikes (each avoided char would force
 * UCS-2 encoding and roughly double the segment cost). */
const gsm7 = (s) => String(s ?? '')
  .replace(/[—–]/g, '-')
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/…/g, '...');

export const smsBody = (title, body) => {
  // Newline layout (title, blank line, body) reads as a real message on
  // handsets. Plain ASCII only, keeping the payload in the GSM-7 alphabet
  // (one segment) instead of forcing UCS-2 (cost ×~2, split risk).
  const text = gsm7(`${String(title ?? '').trim()}\n\n${String(body ?? '').trim()}`.trim());
  return text.length > SMS_MAX ? `${text.slice(0, SMS_MAX - 3)}...` : text;
};

export const pushPayload = ({ title, body, link }, appBaseUrl = '') => ({
  title: String(title ?? 'Diamond Project').slice(0, 120),
  body: String(body ?? '').slice(0, 240),
  url: appBaseUrl ? `${appBaseUrl}${link ?? '/dashboard/notifications/center'}` : (link ?? '/dashboard/notifications/center'),
  tag: 'diamond-project',
});

/**
 * Resolve which off-device channels fire for one recipient.
 * @param {{prefs, category, emailPolicy}} input (`immediate-only` holds
 *   email for non-immediate digests — the digest sender owns those;
 *   `force` sends regardless of prefs — lifecycle/transactional mail
 *   only: welcome, recruit alerts, promotions. SMS/push always stay
 *   prefs-driven under every policy.)
 */
export const resolveChannels = ({ prefs, category, emailPolicy = 'always' } = {}) => {
  const row = prefs?.channels?.[category] ?? { inApp: true, email: false, sms: false, push: false };
  const emailOk = emailPolicy === 'force'
    || (row.email === true && (emailPolicy !== 'immediate-only' || prefs?.emailDigest === 'immediate'));
  return {
    inApp: row.inApp !== false,
    email: emailOk,
    sms: row.sms === true,
    push: row.push === true,
  };
};

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Broadcast/generic email body — real paragraphs (blank lines split, single
 * breaks become <br>), no duplicate title (the branded shell already renders
 * the subject as its heading), and the link as an absolute-URL gold button
 * with a plain-URL fallback. Relative app links would arrive broken, so a
 * base URL is required — callers pass the public web origin.
 */
export const plainEmailHtml = (title, body, link = '/dashboard/notifications/center', baseUrl = 'https://c21fg.online') => {
  const url = toAbsoluteUrl(link, baseUrl);
  const action = url
    ? `<p style="margin:1.4em 0 0.4em;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 28px;background-color:#a97f2c;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">${escapeHtml(title || 'Open Diamond Project')}</a></p>
  <p style="font-size:12px;color:#6e6e6e;word-break:break-all;">${escapeHtml(url)}</p>`
    : '';
  return `${paragraphs(body)}${action}`;
};

const toAbsoluteUrl = (link, baseUrl) => {
  const raw = String(link ?? '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(baseUrl ?? '').replace(/\/+$/, '') || 'https://c21fg.online';
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
};
