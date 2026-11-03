/**
 * Contact-list lifecycle events — emitted when a member submits their
 * onboarding list. Small serializable payload; the fan-out resolves the
 * upline and names subscriber-side.
 */

export const CONTACT_LIST_EVENTS = {
  /** A member submitted ≥MIN_CONTACTS for their upline to work. */
  SUBMITTED: 'contact-list.submitted',
};

/** @param {{partnerId, memberName, batch, count}} input */
export const contactListSubmittedPayload = ({ partnerId, memberName = null, batch, count }) => ({
  type: CONTACT_LIST_EVENTS.SUBMITTED,
  partnerId: String(partnerId),
  memberName: memberName ? String(memberName) : null,
  batch: String(batch),
  count: Number(count) || 0,
});
