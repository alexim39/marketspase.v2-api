import { ValidationException } from '../../../shared/domain/AppError.js';

/**
 * Canonical roles (lowercase). Legacy stored 'User' / 'admin' free-text —
 * normalization absorbs both, so no data migration is required.
 */
export const ROLES = ['user', 'leader', 'admin'];

/**
 * Legacy `g8` accounts normalize to `leader`; G8 is no longer a role or rank
 * in the current four-rank app.
 * @param {unknown} value
 * @returns {'user'|'leader'|'admin'}
 * @throws {ValidationException}
 */
export const normalizeRole = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'g8') return 'leader';
  if (v === 'user' || v === 'leader' || v === 'admin') return v;
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
