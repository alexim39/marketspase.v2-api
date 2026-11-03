/**
 * Public entry for the billing slice (commissions ledger + performance).
 * Money movement happens ONLY in release/void, inside transactions.
 */
export { default, buildBillingRouter } from './interface/Billing.routes.js';
export { computeShares, DEFAULT_RATES } from './domain/CommissionPlan.js';
