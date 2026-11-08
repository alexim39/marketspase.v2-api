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
/** Paid immediately when activation is recorded (no day-7 hold). */
export const MENTOR_BONUS_DAYS = 0;
export const MENTOR_BONUS_EXPIRY_DAYS = 90;

/**
 * Kept for API compatibility. The mentor bonus is always due immediately;
 * a legacy `MENTOR_BONUS_DAYS` environment value is intentionally ignored.
 */
export const mentorBonusDays = () => 0;

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
