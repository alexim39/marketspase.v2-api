import { ValidationException } from '../../../shared/domain/AppError.js';

/** Deposit bounds (NGN) — dust and fat-finger protection, adjustable. */
export const DEPOSIT_MIN_NGN = 100;
export const DEPOSIT_MAX_NGN = 1000000;

export const DEPOSIT_STATUSES = Object.freeze(['created', 'pending', 'success', 'failed', 'closed']);

/** Methods: gateway intents (`opay`) + human-verified claims (`manual`). */
export const DEPOSIT_METHODS = Object.freeze(['opay', 'manual']);

/** Manual-claim lifecycle — decided exactly once by an admin. */
export const MANUAL_CLAIM_STATUSES = Object.freeze(['awaiting-review', 'approved', 'rejected']);

/** Admin direct-credit bounds (wider than member deposits; reason always required). */
export const ADMIN_CREDIT_MIN_NGN = 1;
export const ADMIN_CREDIT_MAX_NGN = 10000000;

/** Naira → kobo integer (Opay `total` is the minor unit). */
export const toKobo = (ngn) => {
  const n = Number(ngn);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationException('Invalid deposit amount');
  return Math.round(n * 100);
};

/** @param {number} ngn */
export const assertDepositAmount = (ngn) => {
  const n = Number(ngn);
  if (!Number.isFinite(n) || n < DEPOSIT_MIN_NGN || n > DEPOSIT_MAX_NGN) {
    throw new ValidationException(
      `Deposit must be between ₦${DEPOSIT_MIN_NGN.toLocaleString()} and ₦${DEPOSIT_MAX_NGN.toLocaleString()}`,
    );
  }
  return n;
};

/** Unique merchant reference — timestamp + entropy (02004 retry regenerates). */
export const newDepositReference = () =>
  `DP${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

/**
 * Business receiving accounts for manual transfer.
 * Env-overridable (`MANUAL_DEPOSIT_ACCOUNTS` JSON) so numbers rotate
 * without a code change; code default is the live Opay pair.
 */
export const DEFAULT_MANUAL_ACCOUNTS = Object.freeze([
  Object.freeze({ bank: 'Opay', number: '6102514335', name: 'ASYNC SOLUTIONS LTD' }),
  Object.freeze({ bank: 'Opay', number: '6102513801', name: 'ASYNC SOLUTIONS LTD' }),
  Object.freeze({ bank: 'Opay', number: '6141809708', name: 'ASYNC SOLUTIONS LTD' }),
]);

export const manualAccounts = (env = process.env) => {
  const raw = env?.MANUAL_DEPOSIT_ACCOUNTS;
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((a) => a && String(a.number ?? '').replace(/\D/g, '').length >= 10)
          .map((a) => ({
            bank: String(a.bank ?? '').slice(0, 40) || 'Bank',
            number: String(a.number ?? '').replace(/\D/g, ''),
            name: String(a.name ?? '').slice(0, 80),
          }));
      }
    } catch { /* fall through to default */ }
  }
  return [...DEFAULT_MANUAL_ACCOUNTS];
};

/**
 * Validate + normalize a manual-transfer claim (details only — no file
 * uploads v1). Throws ValidationException naming the first bad field.
 */
export const assertManualClaim = (input = {}, accounts = DEFAULT_MANUAL_ACCOUNTS) => {
  const amount = assertDepositAmount(input.amountNgn);
  const digits = String(input.destinationAccount ?? '').replace(/\D/g, '');
  const validNumbers = new Set(accounts.map((a) => String(a.number).replace(/\D/g, '')));
  if (!validNumbers.has(digits)) {
    throw new ValidationException('Choose the account you paid into from the listed options');
  }
  const senderName = String(input.senderName ?? '').trim().slice(0, 120);
  if (senderName.length < 2) throw new ValidationException('Enter the sender name on the transfer');
  const senderAccount = String(input.senderAccount ?? '').replace(/\D/g, '');
  if (senderAccount.length < 10 || senderAccount.length > 20) {
    throw new ValidationException('Enter the 10-digit account number you sent from');
  }
  const paidAt = input.paidAt instanceof Date ? input.paidAt : new Date(input.paidAt);
  if (Number.isNaN(paidAt.getTime())) throw new ValidationException('Enter the date you made the transfer');
  if (paidAt.getTime() > Date.now()) throw new ValidationException('Transfer date cannot be in the future');
  if (Date.now() - paidAt.getTime() > 90 * 86400000) {
    throw new ValidationException('Transfer date is too old — contact support for transfers over 90 days');
  }
  const bankReference = String(input.bankReference ?? '').trim().replace(/\s+/g, ' ').slice(0, 64);
  if (bankReference.length < 4) {
    throw new ValidationException('Enter the bank transaction reference / session ID');
  }
  const note = String(input.note ?? '').trim().slice(0, 500);
  return {
    amountNgn: amount,
    destinationAccount: digits,
    senderName,
    senderAccount,
    paidAt,
    bankReference,
    ...(note ? { note } : {}),
  };
};

/** @param {number} ngn admin direct credit bounds. */
export const assertAdminCreditAmount = (ngn) => {
  const n = Number(ngn);
  if (!Number.isFinite(n) || n < ADMIN_CREDIT_MIN_NGN || n > ADMIN_CREDIT_MAX_NGN) {
    throw new ValidationException(
      `Credit must be between ₦${ADMIN_CREDIT_MIN_NGN.toLocaleString()} and ₦${ADMIN_CREDIT_MAX_NGN.toLocaleString()}`,
    );
  }
  return n;
};
