import nodemailer from 'nodemailer';
import { brandEmail } from './emailBrand.js';

/**
 * Outbound mail — single choke point for the whole platform.
 * Transport comes from env (see .env.example # Email Service); the
 * transporter is built lazily so importing this module never throws
 * when vars are missing — sends fail with a clear error instead.
 * Every body is wrapped in the branded shell (subject = title), so all
 * notifications share one look with zero call-site changes.
 */
const mailConfig = () => {
  const port = Number(process.env.EMAIL_PORT || 465);
  const secureRaw = String(process.env.EMAIL_SECURE ?? 'true').trim().toLowerCase();
  const secure = ['true', '1', 'yes'].includes(secureRaw);
  return {
    host: process.env.EMAIL_HOST || '',
    port,
    secure,
    // Port 587 + secure=false means STARTTLS — still encrypted in transit.
    requireTLS: !secure,
    auth: {
      user: process.env.EMAIL_USER || '',
      // EMAILPASS is the legacy var — honored until the dashboard moves over.
      pass: process.env.EMAIL_PASS || process.env.EMAILPASS || '',
    },
  };
};

const fromAddress = () => {
  const name = process.env.EMAIL_FROM_NAME || 'MarketSpase';
  const email = process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER || '';
  return name ? `"${name}" <${email}>` : email;
};

let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    const config = mailConfig();
    if (!config.host || !config.auth.user) {
      throw new Error('Email is not configured (EMAIL_HOST / EMAIL_USER missing)');
    }
    transporter = nodemailer.createTransport(config);
  }
  return transporter;
};

/** Test helper — drops the cached transporter (env swaps between tests). */
export const __resetEmailTransporter = () => {
  transporter = null;
};

/**
 * Partner-app base URL for links inside emails (inbox clients have no
 * router — relative hrefs go nowhere). Same precedence as the auth
 * routes: explicit FRONTEND_URL, then APP_BASE_URL, then production.
 */
export const appBaseUrl = () =>
  (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'https://marketspase.com').replace(/\/+$/, '');

// Reusable function to send emails.
// Never throws: legacy callers `await` this bare inside request flows
// (survey, tickets), so a mail hiccup must not 500 the request.
// Check the returned `{ sent }` when delivery actually matters.
export const sendEmail = async (email, subject, htmlContent, options = {}) => {
  if (['true', '1', 'yes'].includes(String(process.env.MAIL_DISABLED ?? '').toLowerCase())) {
    return { sent: false, error: 'Email is disabled (MAIL_DISABLED)' };
  }
  const html = options.plain
    ? htmlContent
    : brandEmail({
      title: options.title ?? subject,
      body: htmlContent,
      actionUrl: options.actionUrl ?? null,
      actionLabel: options.actionLabel ?? 'Open MarketSpase',
    });
  try {
    await getTransporter().sendMail({
      from: fromAddress(),
      to: email,
      subject,
      html,
    });
    console.log(`Email sent to ${email}`);
    return { sent: true };
  } catch (error) {
    console.error(`Error sending email to ${email}: ${error.message}`);
    return { sent: false, error: error.message };
  }
};
