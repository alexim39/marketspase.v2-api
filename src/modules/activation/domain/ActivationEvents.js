/**
 * Activation lifecycle events — the contract between signup (emitter)
 * and activation subscribers (member welcome). Payloads are plain data
 * (ids + display name); subscribers resolve everything else so events
 * stay small and serializable.
 */

export const ACTIVATION_EVENTS = {
  /** A member completed open signup (after commit, best-effort). */
  MEMBER_SIGNED_UP: 'member.signedup',
};

/**
 * @param {{partnerId, memberName}} input
 */
export const signedUpPayload = ({ partnerId, memberName = 'A new partner' }) => ({
  type: ACTIVATION_EVENTS.MEMBER_SIGNED_UP,
  partnerId: String(partnerId),
  memberName: String(memberName ?? '').trim() || 'A new partner',
});
