/**
 * Prospect-worked lifecycle events — emitted when someone (often the upline)
 * touches a prospect owned by someone else. Small serializable payload; the
 * fan-out notifies the owner subscriber-side. Best-effort throughout.
 */

export const PROSPECT_WORKED_EVENTS = {
  /** A touch (log, stage move, mirrored session outcome) on another's prospect. */
  TOUCHED: 'prospect.worked',
};

/** @param {{prospectId, ownerId, actorId, actorName, kind, label, touchId}} input */
export const prospectWorkedPayload = ({
  prospectId,
  ownerId,
  actorId,
  actorName = null,
  kind = 'touch',
  label = '',
  touchId = '',
}) => ({
  type: PROSPECT_WORKED_EVENTS.TOUCHED,
  prospectId: String(prospectId),
  ownerId: String(ownerId),
  actorId: String(actorId),
  actorName: actorName ? String(actorName) : null,
  kind: String(kind),
  label: String(label).slice(0, 120),
  touchId: String(touchId),
});
