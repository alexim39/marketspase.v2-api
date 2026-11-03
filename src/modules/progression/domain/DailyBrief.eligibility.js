/**
 * Daily-brief eligibility + focus — recomputed per partner on every run.
 * Pure: no Mongo, fully unit-testable.
 *
 * Eligibility is deliberately narrow so the brief never becomes noise:
 * the partner must still want daily items in-app AND have something
 * actionable today. `briefFocus` orders the ≤3 priorities: builders lead
 * with follow-ups, leaders lead with goals.
 */

export const DAILY_SKIP_REASONS = ['opted-out', 'nothing-actionable'];

/** @param {{level, candidateCount, dailyOptIn}} input @returns {{eligible, reason}} */
export const dailyEligibility = ({ level = 'partner', candidateCount = 0, dailyOptIn = true } = {}) => {
  void level;
  if (dailyOptIn === false) return { eligible: false, reason: 'opted-out' };
  if ((Number(candidateCount) || 0) <= 0) return { eligible: false, reason: 'nothing-actionable' };
  return { eligible: true, reason: 'actionable' };
};

const LEADERSHIP_LEVELS = ['ecl', 'cell_leader', 'g_leader', 'g8'];

/** Journey stage decides brief ordering — recomputed daily, never stored. */
export const briefFocus = (level = 'partner') => (
  LEADERSHIP_LEVELS.includes(String(level ?? 'partner')) ? 'leadership' : 'growth'
);
