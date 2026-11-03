import { ValidationException } from '../../../shared/domain/AppError.js';

/**
 * Bulk-SMS domain rules — pure, unit-testable.
 * Mirrors the legacy client-side rules (Nigerian mobiles, 160-char pages)
 * so the server enforces what the composer previews.
 */

/** Max recipients per request (gateway + wallet safety bound). */
export const MAX_SMS_RECIPIENTS = 200;

/** Max recipients per email send (provider + safety bound). */
export const MAX_EMAIL_RECIPIENTS = 200;

/**
 * Wallet charge per recipient per page (₦).
 * Single source of truth — the legacy billing controller and the composer
 * preview mirror this value (see SMS_PRICE_PER_PAGE). Must stay above the
 * gateway unit cost (≈₦6.49, plus multi-segment Unicode pages): ₦10 leaves
 * ≈35% gross margin for failure leakage, support and infra.
 * Env-overridable without a code change: SMS_PRICE_PER_PAGE=10.
 */
export const SMS_CHARGE_PER_PAGE =
  Number(process.env.SMS_PRICE_PER_PAGE ?? 10) > 0 ? Number(process.env.SMS_PRICE_PER_PAGE ?? 10) : 10;

const NG_MOBILE_RE = /^(?:\+?234|0)([789]\d{9})$/;

/** Normalize to local `0...` form; null when not a Nigerian mobile. */
export const normalizeNgPhone = (value) => {
  const raw = String(value ?? '').trim().replace(/[\s\-().]/g, '');
  const m = NG_MOBILE_RE.exec(raw);
  if (!m) return null;
  return `0${m[1]}`;
};

export const smsPages = (body) => Math.max(1, Math.ceil(String(body ?? '').length / 160));

export const smsCost = (recipients, body) =>
  Math.round(recipients * smsPages(body) * SMS_CHARGE_PER_PAGE * 100) / 100;

/** @param {{to, body}} input (already Zod-shaped, defense in depth) */
export const createBulkSmsEntity = (input) => {
  const body = String(input.body ?? '').trim();
  if (body.length < 1 || body.length > 960) throw new ValidationException('Message must be 1–960 characters');
  const list = Array.isArray(input.to) ? input.to : [];
  if (list.length === 0) throw new ValidationException('Add at least one recipient');
  if (list.length > MAX_SMS_RECIPIENTS) {
    throw new ValidationException(`At most ${MAX_SMS_RECIPIENTS} recipients per send`);
  }
  const seen = new Set();
  const to = [];
  for (const raw of list) {
    const normalized = normalizeNgPhone(raw);
    if (!normalized) throw new ValidationException(`Invalid Nigerian mobile number: ${String(raw ?? '').slice(0, 20)}`);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      to.push(normalized);
    }
  }
  return { to, body, pages: smsPages(body), cost: smsCost(to.length, body) };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {{to, subject, body}} input (already Zod-shaped, defense in depth) */
export const createBulkEmailEntity = (input) => {
  const subject = String(input.subject ?? '').trim();
  if (subject.length < 1 || subject.length > 120) throw new ValidationException('Subject must be 1–120 characters');
  const body = String(input.body ?? '').trim();
  if (body.length < 1 || body.length > 20000) throw new ValidationException('Message must be 1–20000 characters');
  const list = Array.isArray(input.to) ? input.to : [];
  if (list.length === 0) throw new ValidationException('Add at least one recipient');
  if (list.length > MAX_EMAIL_RECIPIENTS) {
    throw new ValidationException(`At most ${MAX_EMAIL_RECIPIENTS} recipients per send`);
  }
  const seen = new Set();
  const to = [];
  for (const raw of list) {
    const email = String(raw ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw new ValidationException(`Invalid email address: ${String(raw ?? '').slice(0, 40)}`);
    }
    if (!seen.has(email)) {
      seen.add(email);
      to.push(email);
    }
  }
  return { to, subject, body };
};
