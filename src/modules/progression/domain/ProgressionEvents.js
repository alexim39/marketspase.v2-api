/**
 * Progression lifecycle events — emitted by the journey read model when it
 * detects (and persists) a level-up. Small serializable payloads; the
 * notifications slice subscribes, the ladder never imports it.
 */

export const PROGRESSION_EVENTS = {
  /** A member's stored level just advanced (fires exactly once per rank). */
  PROMOTED: 'progression.promoted',
  /** A member marked training done → upline confirmation requested. */
  TRAINING_CONFIRM_REQUESTED: 'progression.training.requested',
  /** An upline decided a training confirmation (approved or declined). */
  TRAINING_CONFIRM_DECIDED: 'progression.training.decided',
  /** All of IPO/QSG/SMO now confirmed — full training track complete. */
  TRAINING_TRACK_COMPLETED: 'progression.training.trackCompleted',
};

/**
 * @param {{partnerId, from, to, toLabel, memberName, uplineId}} input
 * (names/ids null when unresolvable — subscribers degrade gracefully.)
 */
export const promotedPayload = ({ partnerId, from, to, toLabel = null, memberName = null, uplineId = null }) => ({
  type: PROGRESSION_EVENTS.PROMOTED,
  partnerId: String(partnerId),
  from: String(from),
  to: String(to),
  toLabel: toLabel ? String(toLabel) : String(to),
  memberName: memberName ? String(memberName) : null,
  uplineId: uplineId ? String(uplineId) : null,
});

/**
 * @param {{partnerId, key, keyLabel, memberName, uplineId, cycle}} input
 * (`cycle` = the request stamp's ms — each re-mark after a decline is a
 * new cycle, so idempotency keys never collide across cycles. Upline
 * resolved by the emitter when cheap, else by the subscriber.)
 */
export const trainingRequestedPayload = ({ partnerId, key, keyLabel, memberName = null, uplineId = null, cycle = null }) => ({
  type: PROGRESSION_EVENTS.TRAINING_CONFIRM_REQUESTED,
  partnerId: String(partnerId),
  key: String(key),
  keyLabel: String(keyLabel ?? key),
  memberName: memberName ? String(memberName) : null,
  uplineId: uplineId ? String(uplineId) : null,
  cycle: cycle ?? Date.now(),
});

/** @param {{partnerId, key, keyLabel, approved, note, memberName, cycle}} input */
export const trainingDecidedPayload = ({ partnerId, key, keyLabel, approved, note = '', memberName = null, cycle = null }) => ({
  type: PROGRESSION_EVENTS.TRAINING_CONFIRM_DECIDED,
  partnerId: String(partnerId),
  key: String(key),
  keyLabel: String(keyLabel ?? key),
  approved: approved === true,
  note: String(note ?? '').slice(0, 500),
  memberName: memberName ? String(memberName) : null,
  cycle: cycle ?? Date.now(),
});

/** @param {{partnerId, memberName}} input (upline resolved subscriber-side). */
export const trainingTrackCompletedPayload = ({ partnerId, memberName = null }) => ({
  type: PROGRESSION_EVENTS.TRAINING_TRACK_COMPLETED,
  partnerId: String(partnerId),
  memberName: memberName ? String(memberName) : null,
});
