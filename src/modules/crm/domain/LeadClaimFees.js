/**
 * Buy Prospect claim economics — single source of truth.
 * Claiming a pool lead debits the fee from the partner's wallet;
 * returning it inside the window refunds the smaller amount back.
 * Env-overridable without a code change.
 */
export const LEAD_CLAIM_FEE = Number(process.env.LEAD_CLAIM_FEE ?? 250) > 0
  ? Number(process.env.LEAD_CLAIM_FEE ?? 250)
  : 250;

export const LEAD_RETURN_REFUND = Number(process.env.LEAD_RETURN_REFUND ?? 120) >= 0
  ? Number(process.env.LEAD_RETURN_REFUND ?? 120)
  : 120;
