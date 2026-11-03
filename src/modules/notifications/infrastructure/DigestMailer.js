import { appBaseUrl, sendEmail } from '../../../services/emailService.js';

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Infrastructure client: digest email adapter (N5).
 * Wraps the legacy `sendEmail` so the job stays decoupled and testable.
 * Renders the pure `buildDigest` groups — titles are user input, escaped.
 */
export class DigestMailer {
  /** @param {{send}} deps (defaults to legacy sendEmail) */
  constructor({ send } = {}) {
    this.send = send ?? sendEmail;
  }

  /** @param {{to, digest}} input (digest from `buildDigest`) */
  async sendDigest({ to, digest }) {
    const sections = digest.groups.map((g) => `
      <h3>${escapeHtml(g.label)} (${g.count})</h3>
      <ul>${g.titles.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}${
        g.more > 0 ? `<li>…and ${g.more} more</li>` : ''
      }</ul>
    `).join('');
    const html = `
      <p>Hi there,</p>
      <p>Here's what you missed:</p>
      ${sections}
      <p><a href="${appBaseUrl()}/dashboard/notifications/center">Catch up in Notifications</a></p>
      <p style="color:#888;font-size:12px;">You get this because your email digest is on. Change anytime in Notification settings.</p>
    `;
    await this.send(to, digest.subject, html);
  }
}
