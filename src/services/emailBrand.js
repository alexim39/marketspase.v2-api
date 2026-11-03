/**
 * Shared branded email shell — every outbound mail renders inside it.
 * Dark ink + gold accents mirror the partner app; the logo is an absolute
 * URL because mail clients never load relative paths.
 */
export const BRAND_LOGO_URL = 'https://marketspase.com/logo/marketspase-logo-white.png';
export const BRAND_SUPPORT_EMAIL = 'contacts@marketspase.com';

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Plain-text bodies (composer textarea, admin broadcast) → email HTML.
 * Blank lines start new paragraphs, single breaks become <br> — without
 * this, HTML collapses every line break and the mail arrives as one
 * run-on block. Everything is escaped first (XSS-safe by construction).
 */
export const paragraphs = (text) => {
  const safe = escapeHtml(text).trim();
  if (!safe) return '';
  return safe
    .split(/\r?\n\s*\r?\n/)
    .map((para) => `<p style="margin:0 0 1em;">${para.replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
};

/**
 * @param {{title: string, body: string, actionUrl?: string|null, actionLabel?: string}} input
 * (`body` is trusted inner HTML from our own templates; title/label are escaped.)
 */
export const brandEmail = ({ title, body, actionUrl = null, actionLabel = 'Open MarketSpase' }) => {
  const safeTitle = escapeHtml(title);
  const action = actionUrl
    ? `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 28px;background-color:#667eea;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;margin:1.2em 0;">${escapeHtml(actionLabel)}</a>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f5f3ff;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 12px;">
    <div style="background-color:#14122b;border-radius:10px 10px 0 0;padding:20px;text-align:center;">
      <img src="${BRAND_LOGO_URL}" alt="MarketSpase" style="max-height:56px;max-width:220px;" />
    </div>
    <div style="background-color:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:28px 24px;color:#111827;">
      <h2 style="margin:0 0 12px;color:#14122b;">${safeTitle}</h2>
      <div style="line-height:1.6;">${body}</div>
      ${action}
    </div>
    <p style="text-align:center;color:#6b7280;font-size:12px;margin:16px 0 0;">
      MarketSpase · Need help? write to <a href="mailto:${BRAND_SUPPORT_EMAIL}" style="color:#667eea;">${BRAND_SUPPORT_EMAIL}</a>
    </p>
  </div>
</body></html>`;
};
