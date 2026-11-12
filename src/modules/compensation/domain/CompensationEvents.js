/**
 * Compensation lifecycle events consumed by notification fan-outs.
 * Keep payloads as plain, serializable ids and amounts.
 */
export const COMPENSATION_EVENTS = Object.freeze({
  MENTOR_BONUS_PAID: 'mentor.bonus.paid',
});
