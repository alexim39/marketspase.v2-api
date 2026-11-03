import { sendEmail } from '../../../../services/emailService.js';

/** Infrastructure: password-reset mail adapter (injectable/fakeable in tests). */
export class PasswordResetMailer {
  /** Returns the `{ sent }` receipt so callers can fail honestly on mail outages. */
  async notifyPasswordReset(to, resetUrl) {
    return sendEmail(
      to,
      'Password Reset Request',
      `<h2>Password Reset Request</h2>
       <p>You requested to reset your password. Click the link below to reset it:</p>
       <a href="${resetUrl}" target="_blank">${resetUrl}</a>
       <p>This link will expire in 60 minutes.</p>
       <p>If you did not request this, please ignore this email.</p>`,
    );
  }
}
