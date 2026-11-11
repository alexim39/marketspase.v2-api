import { brandEmail } from '../../../../services/emailBrand.js';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const userBirthdayEmailTemplate = (partner) => {
  const name = escapeHtml(String(partner?.name ?? '').trim() || 'Partner');
  const body = `
    <p style="margin:0 0 1em;">Hi ${name},</p>
    <p style="margin:0 0 1em;">Wishing you a very happy birthday from all of us at <strong>MarketSpase</strong>.</p>
    <p style="margin:0 0 1em;">May your day be filled with joy, laughter and everything that makes you smile. Thank you for being part of this community — we are glad you are here.</p>
    <p style="margin:0 0 1em;">Enjoy your special day.</p>
    <p style="margin:0;">Warm regards,<br><strong>The MarketSpase Team</strong></p>
  `;
  return brandEmail({
    title: `Happy Birthday, ${name}!`,
    body,
    actionUrl: 'https://marketspase.com/dashboard',
    actionLabel: 'Open your dashboard',
  });
};
