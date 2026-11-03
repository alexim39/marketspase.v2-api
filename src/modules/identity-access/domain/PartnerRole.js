import { ValidationException } from '../../../shared/domain/AppError.js';

/**
 * Canonical roles (lowercase). Legacy stored 'User' / 'admin' free-text —
 * normalization absorbs both, so no data migration is required.
 */
export const ROLES = ['user', 'leader', 'g8', 'admin'];

/**
 * G8 is an admin-settable leadership role: approvals, oversight and
 * elevated visibility. Derived ladder level never grants it — only an
 * admin (or bootstrap) can bestow or revoke it.
 * @param {unknown} value
 * @returns {'user'|'leader'|'g8'|'admin'}
 * @throws {ValidationException}
 */
export const normalizeRole = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'user' || v === 'leader' || v === 'g8' || v === 'admin') return v;
  throw new ValidationException(`Invalid role (expected one of: ${ROLES.join(', ')})`);
};

/** Same normalization, but lenient — unknown/missing becomes 'user'. For reads. */
export const lenientRole = (value) => {
  try {
    return normalizeRole(value);
  } catch {
    return 'user';
  }
};

/** Bootstrap allowlist — first admins before any admin exists in DB. */
export const adminBootstrapEmails = () =>
  String(process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
