import { sendEmail } from '../../../../services/emailService.js';
import { env } from '../../../../shared/config/env.js';

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Infrastructure client: owner notification adapter.
 * Wraps the legacy `sendEmail` so the use-case stays decoupled
 * and testable (inject a fake mailer in tests).
 * Same subject/recipients as legacy to preserve behavior;
 * HTML is now escaped (legacy interpolated raw body = XSS in inbox).
 */
export class TicketMailer {
  /** @param {any} ticket domain ticket */
  async notifyOwner(ticket) {
    const subject = 'Diamond Project Ticket Submission';
    const html = `
      <h1>Ticket Submission</h1>
      <p>Kindly note that someone submitted a ticket.</p>
      <br>
      <h1>Complete Ticket Details</h1>
      <p>Subject: ${escapeHtml(ticket.subject)}</p>
      <p>Description: ${escapeHtml(ticket.description)}</p>
      <p>Date of submission: ${escapeHtml(ticket.date)}</p>
      <p>Category: ${escapeHtml(ticket.category)}</p>
      <p>Priority: ${escapeHtml(ticket.priority)}</p>
      <p>Comment: ${escapeHtml(ticket.comment)}</p>
    `;
    for (const to of env.supportOwnerEmails) {
      await sendEmail(to, subject, html);
    }
  }
}
