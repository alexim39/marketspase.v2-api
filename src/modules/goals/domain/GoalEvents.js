/**
 * Goal lifecycle events — emitted by the daily brief (which already holds
 * live progress for every active partner) so goal moments fan out through
 * the same bus as everything else. Payloads are plain serializable data;
 * the fan-out resolves names and uplines subscriber-side.
 */

export const GOAL_EVENTS = {
  /** A goal is off-track with a week or less left — coachable moment. */
  AT_RISK: 'goal.atRisk',
  /** A goal just hit its target — celebration moment. */
  COMPLETED: 'goal.completed',
};

/**
 * @param {{partnerId, goalId, title, remaining, daysLeft, requiredDaily, week}} input
 * (`week` = ISO week stamp — the upline nudge re-fires weekly at most.)
 */
export const goalAtRiskPayload = ({ partnerId, goalId, title, remaining = null, daysLeft = null, requiredDaily = null, week }) => ({
  type: GOAL_EVENTS.AT_RISK,
  partnerId: String(partnerId),
  goalId: String(goalId),
  title: String(title ?? 'Goal').slice(0, 120),
  remaining: remaining ?? null,
  daysLeft: daysLeft ?? null,
  requiredDaily: requiredDaily ?? null,
  week: String(week),
});

/** @param {{partnerId, goalId, title}} input (keyed once ever downstream). */
export const goalCompletedPayload = ({ partnerId, goalId, title }) => ({
  type: GOAL_EVENTS.COMPLETED,
  partnerId: String(partnerId),
  goalId: String(goalId),
  title: String(title ?? 'Goal').slice(0, 120),
});
