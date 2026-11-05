import { MAX_LEVELS, commissionAmount, rateForLevel } from './Compensation.plan.js';

/** Same payment-fee assumption used by activation orders. */
export const PRODUCT_PAYMENT_FEE_RATE = 0.015;

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Gross margin for one product line.
 *
 *   price × quantity
 *   − COGS × quantity
 *   − shipping borne by the platform × quantity
 *   − payment fee on the line total
 *
 * Floored at zero so a thin-margin product can never create a negative base.
 */
export const productLineMargin = ({
  price,
  quantity,
  cogs = 0,
  shippingCost = 0,
  paymentFeeRate = PRODUCT_PAYMENT_FEE_RATE,
} = {}) => {
  const unitPrice = Math.max(Number(price) || 0, 0);
  const qty = Math.max(Number(quantity) || 0, 0);
  if (unitPrice <= 0 || qty <= 0) return 0;

  const gross = unitPrice * qty;
  const cost = Math.max(Number(cogs) || 0, 0) * qty;
  const shipping = Math.max(Number(shippingCost) || 0, 0) * qty;
  const fee = gross * Math.max(Number(paymentFeeRate) || 0, 0);

  return round(Math.max(gross - cost - shipping - fee, 0));
};

/**
 * Split a cart into total margin and commissionable margin.
 * Products marked `commissionable: false` still contribute to gross margin,
 * but create no unilevel payout.
 */
export const summarizeProductMargins = (lines = []) => {
  let grossMargin = 0;
  let commissionableMargin = 0;

  for (const line of lines) {
    const margin = productLineMargin(line);
    grossMargin += margin;
    if (line.commissionable === true) commissionableMargin += margin;
  }

  return {
    grossMargin: round(grossMargin),
    commissionableMargin: round(commissionableMargin),
  };
};

/** Level shares of the commissionable margin, capped by the growth plan. */
export const productCommissionShares = (commissionableMargin) => {
  const margin = Math.max(Number(commissionableMargin) || 0, 0);
  return Array.from({ length: MAX_LEVELS }, (_, index) => {
    const level = index + 1;
    return {
      level,
      rate: rateForLevel(level),
      amount: commissionAmount(margin, level),
    };
  }).filter((share) => share.amount > 0);
};
