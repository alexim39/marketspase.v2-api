import { RANKS } from './Compensation.plan.js';

const RANK_BY_LOWER = new Map(RANKS.map((rank) => [rank.toLowerCase(), rank]));

/** Normalise a journey level (`builder`) or rank label (`Builder`) to a plan rank. */
export const rankLabel = (value, fallback = 'Partner') => (
  RANK_BY_LOWER.get(String(value ?? '').trim().toLowerCase()) ?? fallback
);

/** Progression emits lowercase levels; commission ranks use title-case labels. */
export const rankFromJourneyLevel = (level) => rankLabel(level, 'Partner');

/** A manual override is active until its optional expiry; null expiry = permanent. */
export const isManualOverrideActive = (partner = {}, now = new Date()) => {
  if (partner.commissionRankSource !== 'admin') return false;
  if (!partner.commissionRankOverrideUntil) return true;
  const until = new Date(partner.commissionRankOverrideUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > now.getTime();
};

/** Auto-sync must not overwrite an active admin override or untagged legacy rows. */
export const shouldAutoSyncRank = (partner = {}, now = new Date()) => {
  if (partner.commissionRankSource === 'auto') return true;
  if (partner.commissionRankSource === 'admin') return !isManualOverrideActive(partner, now);
  return false;
};
