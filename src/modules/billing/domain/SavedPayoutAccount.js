import crypto from 'node:crypto';

/** A partner may keep at most this many payout destinations. */
export const MAX_SAVED_PAYOUT_ACCOUNTS = 5;

const hashSecret = () => String(
  process.env.PAYOUT_ACCOUNT_HASH_SECRET
  ?? process.env.KYC_HASH_SECRET
  ?? process.env.JWTTOKENSECRET
  ?? 'marketspase-payout-account',
);

/**
 * Deterministic, non-reversible fingerprint used only for de-duplication.
 * The full account number stays sealed in `accountNumberSealed`.
 */
export const hashPayoutAccount = (accountNumber) => crypto
  .createHmac('sha256', hashSecret())
  .update(String(accountNumber ?? '').replace(/\D/g, ''))
  .digest('hex');
