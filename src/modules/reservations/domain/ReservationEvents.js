/**
 * Reservation lifecycle events — the contract between signup (emitter)
 * and activation subscribers (prospect-close, upline notify).
 * Payloads are plain data (ids + display name); subscribers resolve
 * everything else so events stay small and serializable.
 */

export const RESERVATION_EVENTS = {
  /** A member signed up consuming a code (after commit, best-effort). */
  CONSUMED: 'reservation.consumed',
};

/**
 * @param {{code, partnerId, uplineId, prospectId, memberName}} input
 * (`uplineId`/`prospectId` null when the code carried neither.)
 */
export const consumedPayload = ({ code, partnerId, uplineId = null, prospectId = null, memberName = 'A new partner' }) => ({
  type: RESERVATION_EVENTS.CONSUMED,
  code: String(code ?? '').trim(),
  partnerId: String(partnerId),
  uplineId: uplineId ? String(uplineId) : null,
  prospectId: prospectId ? String(prospectId) : null,
  memberName: String(memberName ?? '').trim() || 'A new partner',
});
