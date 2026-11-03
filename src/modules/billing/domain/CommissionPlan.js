import { ValidationException } from '../../../shared/domain/AppError.js';

/**
 * Compensation plan — unilevel (signed-off defaults).
 * Rates live in the `commission-plans` collection (admin-editable);
 * these constants are the seed + fallback. Buyer is always excluded.
 */
export const DEFAULT_RATES = [0.1, 0.05, 0.03, 0.02, 0.01];
export const MAX_LEVELS = 5;

export const COMMISSION_STATUS = ['Pending', 'Released', 'Voided', 'Reversed'];

/** Naira-safe rounding to 2dp. */
export const money = (n) => Math.round(Number(n) * 100) / 100;

/**
 * @param {number} purchaseTotal
 * @param {number[]} rates
 * @returns {Array<{level:number, rate:number, amount:number}>} levels with amount > 0
 */
export const computeShares = (purchaseTotal, rates = DEFAULT_RATES) => {
  const total = Number(purchaseTotal);
  if (!Number.isFinite(total) || total <= 0) throw new ValidationException('Invalid purchase total');
  return rates.slice(0, MAX_LEVELS).map((rate, i) => ({
    level: i + 1,
    rate,
    amount: money(total * rate),
  })).filter((s) => s.amount > 0);
};

/** @param {unknown} status */
export const assertCommissionStatus = (status) => {
  if (!COMMISSION_STATUS.includes(status)) throw new ValidationException('Invalid commission status');
  return status;
};
