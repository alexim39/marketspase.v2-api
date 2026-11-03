import { sendEmail } from '../../../../services/emailService.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Infrastructure: email-verification mail adapter (injectable/fakeable in tests). */
export class EmailVerificationMailer {
  async notifyVerification(to, verifyUrl, { name } = {}) {
    const firstName = String(name ?? '').trim().split(/\s+/)[0] || 'there';
    const safeUrl = escapeHtml(verifyUrl);
    return sendEmail(
      to,
      'Verify your email to activate your MarketSpase account',
      `<h2>Welcome to MarketSpase</h2>
       <p>Hi ${escapeHtml(firstName)},</p>
       <p>You’re one step away from your digital network marketing workspace. Confirm your email address to activate your account and sign in.</p>
       <p><strong>This link expires in 24 hours</strong> and can only be used once.</p>
       <p style="margin-top:1.4em;color:#6b7280;font-size:13px;line-height:1.6;">
         If the button above doesn’t work, copy and paste this link into your browser:<br>
         <a href="${safeUrl}" style="color:#667eea;word-break:break-all;">${safeUrl}</a>
       </p>
       <p style="color:#6b7280;font-size:13px;line-height:1.6;">
         If you didn’t create a MarketSpase account, you can safely ignore this email.
       </p>`,
      { actionUrl: verifyUrl, actionLabel: 'Verify email address' },
    );
  }
}
