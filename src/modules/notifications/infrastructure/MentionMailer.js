import { appBaseUrl, sendEmail } from '../../../services/emailService.js';

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Infrastructure client: @mention email adapter (N4).
 * Wraps the legacy `sendEmail` so the fan-out stays decoupled and
 * testable (inject a fake mailer in tests). HTML is escaped —
 * mention bodies are user input, never trusted in an inbox.
 * SMS/push have no backend sender yet, so email is the only
 * off-device channel; the preference matrix already reserves both.
 */
export class MentionMailer {
  /** @param {{send}} deps (defaults to legacy sendEmail) */
  constructor({ send } = {}) {
    this.send = send ?? sendEmail;
  }

  /** @param {{authorName, excerpt, sourceType}} input @returns {{subject, html}} */
  buildMention({ authorName, excerpt, sourceType }) {
    return {
      subject: `${authorName} mentioned you on Diamond Project`,
      html: `
      <p>Hi there,</p>
      <p><strong>${escapeHtml(authorName)}</strong> mentioned you in a ${escapeHtml(sourceType)}:</p>
      <blockquote>${escapeHtml(excerpt)}</blockquote>
      <p><a href="${appBaseUrl()}/dashboard/community">View it in Community</a></p>
      <p style="color:#888;font-size:12px;">You get this because community email is on and your digest is immediate. Change anytime in Notification settings.</p>
    `,
    };
  }

  /** @param {{to, authorName, excerpt, sourceType}} input */
  async sendMention({ to, authorName, excerpt, sourceType }) {
    const { subject, html } = this.buildMention({ authorName, excerpt, sourceType });
    await this.send(to, subject, html);
  }
}
