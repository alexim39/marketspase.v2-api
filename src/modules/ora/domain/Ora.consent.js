/**
 * Automated contact consent for Ora.
 *
 * Manual/contact-list prospects must explicitly opt in. Survey-sourced leads
 * (Website, Unique Link) and admin-assigned page leads are opt-in by submission,
 * so they remain eligible even on older rows that predate the boolean field.
 */
export const OPT_IN_SOURCES = new Set(['Website', 'Unique Link', 'Admin Push']);

export const hasAutomationConsent = (prospect) => {
  if (!prospect) return false;
  if (prospect.consentToContact === true) return true;
  return OPT_IN_SOURCES.has(String(prospect.prospectSource ?? '').trim());
};
