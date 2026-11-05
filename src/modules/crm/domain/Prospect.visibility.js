/**
 * Prospect contact visibility for coaching surfaces.
 *
 * - Owner and admin see the contact details they are responsible for.
 * - A direct referral upline sees phone/email only when the prospect consented.
 * - Everyone else sees the contact without phone/email.
 *
 * Masking happens server-side; clients receive nulls plus a display reason.
 */
export const prospectContactAccess = ({
  consentToContact = false,
  canViewContact = false,
  bypassConsent = false,
} = {}) => {
  if (!canViewContact) return { visible: false, reason: 'not-direct' };
  if (!bypassConsent && !consentToContact) return { visible: false, reason: 'no-consent' };
  return { visible: true, reason: null };
};

export const maskProspectContact = (
  doc,
  { canViewContact = false, bypassConsent = false } = {},
) => {
  const o = typeof doc?.toObject === 'function' ? doc.toObject() : { ...(doc ?? {}) };
  const access = prospectContactAccess({
    consentToContact: o.consentToContact === true,
    canViewContact,
    bypassConsent,
  });
  const hasPhone = Boolean(o.prospectPhone);
  const hasEmail = Boolean(o.prospectEmail);
  const phoneVisible = access.visible && hasPhone;
  const emailVisible = access.visible && hasEmail;

  o.phoneHiddenReason = phoneVisible ? null : (access.reason ?? 'no-phone');
  o.emailHiddenReason = emailVisible ? null : (access.reason ?? 'no-email');
  o.prospectPhone = phoneVisible ? o.prospectPhone : null;
  o.prospectEmail = emailVisible ? o.prospectEmail : null;
  if (!phoneVisible) o.bestTimeToCall = null;
  return o;
};
