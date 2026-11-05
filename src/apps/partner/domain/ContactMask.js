/**
 * Privacy masks for partner contact details.
 * Used only by team-facing reads; admin support surfaces can request the
 * unmasked response.
 */

export const maskEmail = (value) => {
  const email = String(value ?? '').trim();
  const at = email.lastIndexOf('@');
  if (at <= 0) return email ? '***' : '';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return '***';
  const keep = local.length <= 2 ? 1 : local.length < 8 ? Math.min(4, local.length - 1) : 5;
  const stars = Math.min(5, Math.max(3, local.length - keep));
  return `${local.slice(0, keep)}${'*'.repeat(stars)}@${domain}`;
};

export const maskPhone = (value) => {
  const compact = String(value ?? '').trim().replace(/\s+/g, '');
  if (!compact) return '';
  if (compact.length <= 4) return '***';
  return `${compact.slice(0, 4)}***`;
};

/** Clone a partner-shaped object with email/phone masked. Never mutates input. */
export const maskPartnerContact = (partner, enabled = true) => {
  if (!enabled || !partner) return partner;
  const out = typeof partner.toObject === 'function' ? partner.toObject() : { ...partner };
  out.email = maskEmail(out.email);
  out.phone = maskPhone(out.phone);
  if (out.displayEmail) out.displayEmail = maskEmail(out.displayEmail);
  if (out.displayPhone) out.displayPhone = maskPhone(out.displayPhone);
  return out;
};
