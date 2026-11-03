/**
 * Buy Prospect fairness engine — pure domain rules.
 * Pool rows are platform-owned survey docs; claims copy them into personal
 * pipelines. Everything time-based runs off `claimedAt` on the prospect.
 */
import { normalizeState, sameState } from '../../../shared/geo/nigerianStates.js';

export { normalizeState, sameState };

/** Hours a claimed lead must show activity before it auto-returns. */
export const CLAIM_WORK_HOURS = Number(process.env.LEAD_CLAIM_HOURS ?? 48) > 0
  ? Number(process.env.LEAD_CLAIM_HOURS ?? 48)
  : 48;

/** Max paid claims per partner per calendar day (anti-hoarding). */
export const DAILY_CLAIM_LIMIT = Number(process.env.LEAD_DAILY_LIMIT ?? 100) > 0
  ? Math.floor(Number(process.env.LEAD_DAILY_LIMIT ?? 100))
  : 100;

/** Warn the holder this long before the work window closes. */
export const EXPIRY_WARNING_HOURS = 12;

/** Freshness decays to zero over this many days (score input). */
export const FRESHNESS_WINDOW_DAYS = 14;

const numEnv = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const claimWindows = () => ({
  workHours: numEnv(process.env.LEAD_CLAIM_HOURS, 48),
  dailyLimit: Math.floor(numEnv(process.env.LEAD_DAILY_LIMIT, 100)),
  warningHours: numEnv(process.env.LEAD_WARNING_HOURS, EXPIRY_WARNING_HOURS),
});

/** Normalize free-text Nigerian states so pool rows match partner states. */
const has = (v) => String(v ?? '').trim().length > 0;
const hasEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim());
const eager = (v) => /(very|extremely|highly|desperate|must|eager)/i.test(String(v ?? ''));
const warm = (v) => /(somewhat|moderate|interested|curious|open|willing)/i.test(String(v ?? ''));

/**
 * Priority score 0–100 + member-facing badges/reasons (never raw numbers).
 * Freshness 40 · engagement 30 · completeness 20 · ratings 10, minus 10
 * per prior return (chronic returners sink). Missing data scores neutral —
 * never punitive, except returns which are earned.
 */
export const scoreLead = (survey = {}, { now = Date.now(), avgRating = null, returnCount = 0 } = {}) => {
  let score = 0;
  const reasons = [];

  // Freshness (40): linear decay over the window.
  const created = new Date(survey.createdAt).getTime();
  const ageDays = Number.isFinite(created) ? Math.max(0, (now - created) / 86400000) : FRESHNESS_WINDOW_DAYS;
  const fresh = Math.max(0, 40 * (1 - ageDays / FRESHNESS_WINDOW_DAYS));
  score += fresh;
  if (ageDays < 2) reasons.push('Just arrived');

  // Engagement (30): what they told us in answers.
  let engagement = 0;
  if (eager(survey.importanceOfPassiveIncome)) { engagement += 15; reasons.push('Says passive income matters a lot'); }
  else if (warm(survey.importanceOfPassiveIncome)) { engagement += 8; reasons.push('Open to passive income'); }
  if (eager(survey.onlineBusinessTimeDedication) || warm(survey.onlineBusinessTimeDedication)) {
    engagement += 10; reasons.push('Has weekly hours to dedicate');
  }
  if (eager(survey.comfortWithTech) || warm(survey.comfortWithTech)) { engagement += 5; }
  score += Math.min(30, engagement);

  // Completeness (20): reachable today?
  let complete = 0;
  if (has(survey.name) && has(survey.surname)) complete += 6;
  else if (has(survey.name)) complete += 3;
  if (has(survey.phoneNumber)) complete += 6;
  if (hasEmail(survey.email)) { complete += 8; reasons.push('Email on file'); }
  score += complete;

  // Ratings (10): neutral 5 when unrated.
  if (avgRating !== null && avgRating !== undefined && Number.isFinite(Number(avgRating))) {
    score += Math.max(0, Math.min(10, (Number(avgRating) / 5) * 10));
    if (Number(avgRating) >= 4) reasons.push('Highly rated by partners');
  } else {
    score += 5;
  }

  // Returns sink (earned penalty).
  score -= Math.max(0, Number(returnCount) || 0) * 10;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const badges = [];
  if (score >= 70) badges.push('Hot');
  if (ageDays < 2) badges.push('New');
  if (complete >= 18) badges.push('Complete');
  return { score, badges, reasons: reasons.slice(0, 2) };
};

/** Claim-expiry bookkeeping for one prospect row (pure, testable). */
export const claimExpiry = (prospect, { now = Date.now(), workHours = CLAIM_WORK_HOURS } = {}) => {
  if (!prospect?.claimedAt) return { expirable: false, reason: 'untracked' };
  const claimedAt = new Date(prospect.claimedAt).getTime();
  if (!Number.isFinite(claimedAt)) return { expirable: false, reason: 'untracked' };
  const deadline = claimedAt + workHours * 3600000;
  const worked = prospectWorkedAfter(prospect, claimedAt);
  return {
    expirable: !worked && now >= deadline,
    secured: worked,
    deadline,
    msLeft: Math.max(0, deadline - now),
  };
};

/** Any logged touch after the claim counts as work (call, booking, move, message). */
export const prospectWorkedAfter = (prospect, claimedAtMs) => {
  const after = (t) => {
    const ms = new Date(t).getTime();
    return Number.isFinite(ms) && ms > claimedAtMs;
  };
  const comms = Array.isArray(prospect?.communications) ? prospect.communications : [];
  if (comms.some((c) => after(c?.createdAt ?? c?.date))) return true;
  const stages = Array.isArray(prospect?.stageHistory) ? prospect.stageHistory : [];
  if (stages.some((h) => after(h?.at))) return true;
  return false;
};
