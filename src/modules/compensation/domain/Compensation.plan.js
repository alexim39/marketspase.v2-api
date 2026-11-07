export const LEVEL_RATES = Object.freeze([0.09, 0.045, 0.025, 0.015, 0.01]);
export const MAX_LEVELS = LEVEL_RATES.length;
export const RANK_DEPTH = Object.freeze({
  Partner: 1,
  Builder: 2,
  Leader: 3,
  Ambassador: 5,
});
export const RANKS = Object.freeze(['Partner', 'Builder', 'Leader', 'Ambassador']);
export const MENTOR_BONUS_AMOUNT = Number(process.env.ACTIVATION_MENTOR_BONUS_NGN ?? 1000);
export const MENTOR_BONUS_DAYS = 7;
export const MENTOR_BONUS_EXPIRY_DAYS = 90;

/**
 * Delay before the mentor bonus becomes payable.
 * 0 means "next hourly mentor-bonus run" rather than a separate instant payout.
 * Invalid values fall back to the approved 7-day default.
 */
export const mentorBonusDays = () => {
  const raw = Number(process.env.MENTOR_BONUS_DAYS ?? MENTOR_BONUS_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : MENTOR_BONUS_DAYS;
};

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const rankDepth = (rank) => RANK_DEPTH[rank] ?? RANK_DEPTH.Partner;

export const rateForLevel = (level) => {
  const n = Number(level);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LEVELS) return 0;
  return LEVEL_RATES[n - 1];
};

export const commissionAmount = (grossMargin, level) => {
  const margin = Math.max(Number(grossMargin) || 0, 0);
  return round(margin * rateForLevel(level));
};

export const depthAllows = (rank, level) => Number(level) <= rankDepth(rank);

export const planSummary = () => ({
  rates: LEVEL_RATES.map((rate, index) => ({
    level: index + 1,
    rate,
    percent: round(rate * 100),
  })),
  ranks: RANKS.map((rank) => ({
    rank,
    depth: rankDepth(rank),
  })),
  mentorBonus: {
    amount: MENTOR_BONUS_AMOUNT,
    daysAfterActivation: mentorBonusDays(),
  },
});
