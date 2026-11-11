/**
 * Product pricing and profitability rules.
 *
 * The platform can sell a product:
 *   - direct / activation: `price` is the platform selling price
 *   - resale: `partnerPrice` is the wholesale price the partner pays
 *   - both: the wholesale channel is treated as the primary platform revenue
 *
 * `retailPrice` is the price the partner is advised to charge the customer.
 * Partner margin is therefore:
 *
 *   retailPrice × (1 − storeServiceFee) − partnerPrice
 *
 * The engine is deliberately conservative: it reserves commission, refunds,
 * rank/generation bonuses and platform handling before declaring a product
 * profitable. A product that cannot clear the minimum floors must not publish.
 */

export const PRODUCT_COST_FIELDS = Object.freeze([
  'manufacturing',
  'packaging',
  'inboundFreight',
  'duties',
  'other',
  'lastMileShipping',
  'handling',
  'acquisitionAllowance',
]);

export const PRODUCT_PRICING_MODES = Object.freeze(['resale', 'direct', 'both']);

export const PRODUCT_PRICING_STATUSES = Object.freeze([
  'healthy',
  'thin',
  'blocked',
  'incomplete',
]);

const DEFAULT_POLICY = Object.freeze({
  paymentFeeRate: 0.015,
  refundReserveRate: 0.03,
  rankReserveRate: 0.015,
  commissionRate: 0.185,
  targetPlatformContributionPct: 0.10,
  minPlatformContributionPct: 0.05,
  minPlatformContributionAmount: 2000,
  targetPartnerMarginPct: 0.30,
  minPartnerMarginPct: 0.20,
  storeServiceFeePct: 0.02,
  roundTo: 100,
});

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const nonNegative = (value, fallback = 0) => Math.max(num(value, fallback), 0);

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const roundRatio = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

const pct = (value, fallback) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  // Accept both 10 (percent) and 0.10 (rate).
  return Math.min(Math.max(n > 1 ? n / 100 : n, 0), 1);
};

const rate = (value, fallback) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n > 1 ? n / 100 : n, 0), 1);
};

export const normalizePricingMode = (value) => (
  PRODUCT_PRICING_MODES.includes(value) ? value : 'resale'
);

/**
 * Environment-backed policy. The admin UI may override target margins for a
 * single preview, but the platform floors always come from here.
 */
export const pricingPolicy = (overrides = {}) => ({
  paymentFeeRate: rate(overrides.paymentFeeRate ?? process.env.PRODUCT_PAYMENT_FEE_RATE, DEFAULT_POLICY.paymentFeeRate),
  refundReserveRate: rate(overrides.refundReserveRate ?? process.env.PRODUCT_REFUND_RESERVE_RATE, DEFAULT_POLICY.refundReserveRate),
  rankReserveRate: rate(overrides.rankReserveRate ?? process.env.PRODUCT_RANK_RESERVE_RATE, DEFAULT_POLICY.rankReserveRate),
  commissionRate: rate(
    overrides.commissionRate
      ?? process.env.PRODUCT_COMMISSION_RATE
      ?? (process.env.PRODUCT_COMMISSION_PLAN === 'legacy' ? 0.21 : 0.185),
    DEFAULT_POLICY.commissionRate,
  ),
  targetPlatformContributionPct: pct(
    overrides.targetPlatformContributionPct ?? process.env.PRODUCT_TARGET_PLATFORM_CONTRIBUTION_PCT,
    DEFAULT_POLICY.targetPlatformContributionPct,
  ),
  minPlatformContributionPct: pct(
    overrides.minPlatformContributionPct ?? process.env.PRODUCT_MIN_PLATFORM_CONTRIBUTION_PCT,
    DEFAULT_POLICY.minPlatformContributionPct,
  ),
  minPlatformContributionAmount: nonNegative(
    overrides.minPlatformContributionAmount ?? process.env.PRODUCT_MIN_PLATFORM_CONTRIBUTION_AMOUNT,
    DEFAULT_POLICY.minPlatformContributionAmount,
  ),
  targetPartnerMarginPct: pct(
    overrides.targetPartnerMarginPct ?? process.env.PRODUCT_TARGET_PARTNER_MARGIN_PCT,
    DEFAULT_POLICY.targetPartnerMarginPct,
  ),
  minPartnerMarginPct: pct(
    overrides.minPartnerMarginPct ?? process.env.PRODUCT_MIN_PARTNER_MARGIN_PCT,
    DEFAULT_POLICY.minPartnerMarginPct,
  ),
  storeServiceFeePct: pct(
    overrides.storeServiceFeePct
      ?? (process.env.PRODUCT_STORE_SERVICE_FEE_PCT || undefined)
      ?? process.env.STORE_SERVICE_FEE_PERCENT,
    DEFAULT_POLICY.storeServiceFeePct,
  ),
  roundTo: Math.max(Math.round(num(overrides.roundTo, DEFAULT_POLICY.roundTo)), 1),
});

export const normalizeCostBreakdown = (input = {}, policy = pricingPolicy()) => {
  const manufacturing = nonNegative(input.manufacturing);
  const packaging = nonNegative(input.packaging);
  const inboundFreight = nonNegative(input.inboundFreight);
  const duties = nonNegative(input.duties);
  const other = nonNegative(input.other);
  const lastMileShipping = nonNegative(input.lastMileShipping);
  const handling = nonNegative(input.handling);
  const acquisitionAllowance = nonNegative(input.acquisitionAllowance);
  return {
    manufacturing,
    packaging,
    inboundFreight,
    duties,
    other,
    lastMileShipping,
    handling,
    acquisitionAllowance,
    paymentFeeRate: rate(input.paymentFeeRate, policy.paymentFeeRate),
    refundReserveRate: rate(input.refundReserveRate, policy.refundReserveRate),
    rankReserveRate: rate(input.rankReserveRate, policy.rankReserveRate),
    notes: String(input.notes ?? '').trim().slice(0, 1000),
    landedCost: roundMoney(manufacturing + packaging + inboundFreight + duties + other),
    totalCostPerUnit: roundMoney(
      manufacturing
      + packaging
      + inboundFreight
      + duties
      + other
      + lastMileShipping
      + handling
      + acquisitionAllowance,
    ),
  };
};

/**
 * Economics for one selling price. `commissionable: false` removes the
 * unilevel payout but still reserves refunds, fees, rank reserve and handling.
 */
export const platformEconomics = ({
  sellingPrice,
  costBreakdown,
  commissionable = true,
  mentorBonus = 0,
  policy = pricingPolicy(),
} = {}) => {
  const price = nonNegative(sellingPrice);
  const cost = normalizeCostBreakdown(costBreakdown, policy);
  const fee = price * cost.paymentFeeRate;
  const commissionBase = Math.max(price - cost.landedCost - cost.lastMileShipping - fee, 0);
  const commission = commissionable ? commissionBase * policy.commissionRate : 0;
  const refundReserve = price * cost.refundReserveRate;
  const rankReserve = commissionable ? commissionBase * cost.rankReserveRate : 0;
  const bonus = nonNegative(mentorBonus);
  const contribution = price
    - cost.landedCost
    - cost.lastMileShipping
    - fee
    - commission
    - refundReserve
    - rankReserve
    - cost.handling
    - bonus
    - cost.acquisitionAllowance;

  return {
    sellingPrice: roundMoney(price),
    landedCost: cost.landedCost,
    lastMileShipping: cost.lastMileShipping,
    paymentFee: roundMoney(fee),
    commissionBase: roundMoney(commissionBase),
    commission: roundMoney(commission),
    refundReserve: roundMoney(refundReserve),
    rankReserve: roundMoney(rankReserve),
    handling: cost.handling,
    mentorBonus: roundMoney(bonus),
    acquisitionAllowance: cost.acquisitionAllowance,
    totalCostPerUnit: cost.totalCostPerUnit,
    platformContribution: roundMoney(contribution),
    platformContributionPct: price > 0 ? roundRatio(contribution / price) : 0,
    contributionMarginPct: price > 0 ? roundRatio((contribution / price) * 100) : 0,
  };
};

/**
 * Binary-search the lowest price that satisfies `predicate(contribution)`.
 * This handles the commission-base floor (commission is zero on a very thin
 * margin) without piecewise algebra.
 */
const solvePrice = (contributionAt, predicate, { max = 5_000_000 } = {}) => {
  let high = 1;
  while (high < max && !predicate(contributionAt(high), high)) high *= 2;
  if (high >= max && !predicate(contributionAt(high), high)) return null;
  let low = 0;
  for (let i = 0; i < 64; i += 1) {
    const mid = (low + high) / 2;
    if (predicate(contributionAt(mid), mid)) high = mid;
    else low = mid;
  }
  return high;
};

const roundUp = (value, step) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / step) * step;
};

export const partnerMarginFor = ({
  retailPrice,
  partnerPrice,
  storeServiceFeePct = 0,
} = {}) => {
  const retail = nonNegative(retailPrice);
  const wholesale = nonNegative(partnerPrice);
  const fee = retail * nonNegative(storeServiceFeePct);
  const margin = retail - fee - wholesale;
  return {
    retailPrice: roundMoney(retail),
    partnerPrice: roundMoney(wholesale),
    storeServiceFee: roundMoney(fee),
    margin: roundMoney(margin),
    marginPct: retail > 0 ? roundRatio(margin / retail) : 0,
    marginPercent: retail > 0 ? roundRatio((margin / retail) * 100) : 0,
  };
};

/**
 * Full pricing recommendation for the admin wizard.
 *
 * Returns suggested partner/retail prices, the current waterfall, clear
 * blocking reasons and a publishable status. The server recomputes this on
 * every save; the browser preview is only a convenience.
 */
export const computeProductPricing = ({
  mode = 'resale',
  price = 0,
  partnerPrice = 0,
  retailPrice = 0,
  commissionable = true,
  mentorBonus = 0,
  costBreakdown = {},
  policy: policyOverrides = {},
} = {}) => {
  const normalizedMode = normalizePricingMode(mode);
  const policy = pricingPolicy(policyOverrides);
  const cost = normalizeCostBreakdown(costBreakdown, policy);
  const bonus = nonNegative(mentorBonus);
  const sellingPrice = normalizedMode === 'direct'
    ? nonNegative(price)
    : (normalizedMode === 'resale' ? nonNegative(partnerPrice) : (nonNegative(partnerPrice) || nonNegative(price)));

  const contributionAt = (candidate) => platformEconomics({
    sellingPrice: candidate,
    costBreakdown: cost,
    commissionable,
    mentorBonus: bonus,
    policy,
  }).platformContribution;

  const breakEven = solvePrice(contributionAt, (contribution) => contribution >= 0);
  const targetPrice = solvePrice(
    contributionAt,
    (contribution, candidate) => contribution >= candidate * policy.targetPlatformContributionPct,
  );
  const minimumPctPrice = solvePrice(
    contributionAt,
    (contribution, candidate) => contribution >= candidate * policy.minPlatformContributionPct,
  );
  const minimumAmountPrice = solvePrice(
    contributionAt,
    (contribution) => contribution >= policy.minPlatformContributionAmount,
  );

  const minimumViable = Math.max(
    breakEven ?? 0,
    minimumPctPrice ?? 0,
    minimumAmountPrice ?? 0,
  );
  const recommendedPartnerPrice = roundUp(
    Math.max(targetPrice ?? 0, minimumViable),
    policy.roundTo,
  );
  const basisPartnerPrice = nonNegative(partnerPrice) || recommendedPartnerPrice;
  const retailDenominator = 1 - policy.storeServiceFeePct - policy.targetPartnerMarginPct;
  const recommendedRetailPrice = retailDenominator > 0
    ? roundUp(basisPartnerPrice / retailDenominator, policy.roundTo)
    : 0;
  const minimumRetailDenominator = 1 - policy.storeServiceFeePct - policy.minPartnerMarginPct;
  const minimumRetailPrice = minimumRetailDenominator > 0
    ? roundUp(basisPartnerPrice / minimumRetailDenominator, policy.roundTo)
    : 0;

  const current = platformEconomics({
    sellingPrice,
    costBreakdown: cost,
    commissionable,
    mentorBonus: bonus,
    policy,
  });
  const partner = partnerMarginFor({
    retailPrice,
    partnerPrice: nonNegative(partnerPrice),
    storeServiceFeePct: policy.storeServiceFeePct,
  });

  const reasons = [];
  const warnings = [];
  const requiresPartnerMargin = normalizedMode !== 'direct';

  if (cost.landedCost <= 0) {
    reasons.push('Enter the manufacturing or landed product cost.');
  }
  if (sellingPrice <= 0) {
    reasons.push(
      normalizedMode === 'resale'
        ? 'Enter the partner wholesale price.'
        : 'Enter the platform selling price.',
    );
  }
  if (requiresPartnerMargin && normalizedMode === 'both' && nonNegative(partnerPrice) <= 0) {
    reasons.push('Enter the partner wholesale price so partner margin can be checked.');
  }
  if (requiresPartnerMargin && nonNegative(retailPrice) <= 0) {
    reasons.push('Enter a suggested retail price so partner margin can be checked.');
  }

  if (reasons.length === 0) {
    if (current.platformContribution <= 0) {
      reasons.push('This price loses money after all platform costs.');
    } else if (current.platformContributionPct < policy.minPlatformContributionPct
      || current.platformContribution < policy.minPlatformContributionAmount) {
      reasons.push(
        `Platform contribution is below the minimum floor (${(policy.minPlatformContributionPct * 100).toFixed(0)}% and ₦${policy.minPlatformContributionAmount.toLocaleString()}).`,
      );
    } else if (current.platformContributionPct < policy.targetPlatformContributionPct) {
      warnings.push(
        `Platform contribution is below the ${(policy.targetPlatformContributionPct * 100).toFixed(0)}% target.`,
      );
    }

    if (requiresPartnerMargin) {
      if (partner.margin <= 0) {
        reasons.push('The partner would make no profit at this retail price.');
      } else if (partner.marginPct < policy.minPartnerMarginPct) {
        reasons.push(
          `Partner margin is below the minimum floor (${(policy.minPartnerMarginPct * 100).toFixed(0)}%).`,
        );
      } else if (partner.marginPct < policy.targetPartnerMarginPct) {
        warnings.push(
          `Partner margin is below the ${(policy.targetPartnerMarginPct * 100).toFixed(0)}% target.`,
        );
      }
    }
  }

  let status = 'healthy';
  if (reasons.length > 0) {
    const incomplete = cost.landedCost <= 0
      || sellingPrice <= 0
      || (requiresPartnerMargin && (nonNegative(partnerPrice) <= 0 || nonNegative(retailPrice) <= 0));
    status = incomplete ? 'incomplete' : 'blocked';
  } else if (warnings.length > 0) {
    status = 'thin';
  }

  return {
    mode: normalizedMode,
    policy,
    targetPlatformContributionPct: policy.targetPlatformContributionPct,
    minPlatformContributionPct: policy.minPlatformContributionPct,
    minPlatformContributionAmount: policy.minPlatformContributionAmount,
    targetPartnerMarginPct: policy.targetPartnerMarginPct,
    minPartnerMarginPct: policy.minPartnerMarginPct,
    storeServiceFeePct: policy.storeServiceFeePct,
    paymentFeeRate: policy.paymentFeeRate,
    refundReserveRate: policy.refundReserveRate,
    rankReserveRate: policy.rankReserveRate,
    commissionRate: policy.commissionRate,
    costBreakdown: cost,
    sellingPrice: current.sellingPrice,
    landedCost: current.landedCost,
    totalCostPerUnit: current.totalCostPerUnit,
    paymentFee: current.paymentFee,
    commissionBase: current.commissionBase,
    commission: current.commission,
    refundReserve: current.refundReserve,
    rankReserve: current.rankReserve,
    handling: current.handling,
    mentorBonus: current.mentorBonus,
    acquisitionAllowance: current.acquisitionAllowance,
    platformContribution: current.platformContribution,
    platformContributionPct: current.platformContributionPct,
    breakEvenPrice: roundUp(breakEven ?? 0, policy.roundTo),
    minimumViablePrice: roundUp(minimumViable, policy.roundTo),
    minimumRetailPrice,
    recommendedPartnerPrice,
    recommendedRetailPrice,
    partnerMargin: partner.margin,
    partnerMarginPct: partner.marginPct,
    partnerMarginPercent: partner.marginPercent,
    storeServiceFee: partner.storeServiceFee,
    status,
    canPublish: status === 'healthy' || status === 'thin',
    reasons,
    warnings,
    computedAt: new Date().toISOString(),
  };
};

/** Lightweight check used by the product controller before a publish. */
export const validatePublishPricing = (pricing = {}) => {
  const status = String(pricing.status ?? 'incomplete');
  if (status === 'healthy' || status === 'thin') {
    return { ok: true, reasons: [] };
  }
  return {
    ok: false,
    reasons: Array.isArray(pricing.reasons) && pricing.reasons.length > 0
      ? pricing.reasons
      : ['Product pricing has not been validated.'],
  };
};
