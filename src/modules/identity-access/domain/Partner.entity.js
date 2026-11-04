import { ValidationException } from '../../../shared/domain/AppError.js';
import { lenientRole } from './PartnerRole.js';
import { normalizePermissions } from './Permissions.js';

const text = (value, field, { min = 2, max = 80 } = {}) => {
  const v = String(value ?? '').trim();
  if (v.length < min || v.length > max) throw new ValidationException(`Invalid ${field}`);
  return v;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Value Object: Email — normalized lowercase, never raw user input downstream.
 */
export const Email = {
  create(value) {
    const v = String(value ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(v) || v.length > 254) throw new ValidationException('Invalid email');
    return v;
  },
};

/**
 * Value Object: PlainPassword — strength floor enforced ONCE here
 * (legacy had none; min 6 is the single intentional tightening of this slice).
 */
export const PlainPassword = {
  create(value) {
    const v = String(value ?? '');
    if (v.length < 6 || v.length > 128) {
      throw new ValidationException('Password must be between 6 and 128 characters');
    }
    return v;
  },
};

/**
 * Domain Entity factory for signup — pure, no Express/Mongoose/bcrypt.
 * Hashing happens in infrastructure (`BcryptPasswordHasher`); the entity
 * only carries validated plain values plus derived username base.
 * Reservation codes are optional during the transition to open signup.
 *
 * @param {{name,surname,email,phone,password,reservationCode?,tnc}} input (Zod-whitelisted)
 */
export const createSignupEntity = (input) => {
  const entity = {
    name: text(input.name, 'name'),
    surname: text(input.surname, 'surname'),
    email: Email.create(input.email),
    phone: text(input.phone, 'phone', { min: 7, max: 20 }),
    password: PlainPassword.create(input.password),
    tnc: input.tnc ?? false,
  };
  const reservationCode = String(input.reservationCode ?? '').trim();
  if (reservationCode) {
    entity.reservationCode = text(reservationCode, 'reservation code', { min: 3, max: 64 });
  }
  const campaign = String(input.campaign ?? '').trim();
  if (campaign) {
    entity.campaignCode = text(campaign, 'campaign', { min: 3, max: 64 });
  }
  return entity;
};

/** Username rule preserved from legacy: first-initial + surname, lowercased. */
export const baseUsernameFor = (name, surname) =>
  (name.charAt(0) + surname).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Strip secrets before anything leaves the Application layer. */
export const toSafePartner = (doc) => {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete o.password;
  delete o.resetPasswordToken;
  delete o.resetPasswordExpires;
  delete o.emailVerificationTokenHash;
  delete o.emailVerificationExpires;
  if (o._id) o.id = String(o._id);
  // Legacy accounts predate verification and stay verified.
  o.emailVerified = o.emailVerified !== false;
  o.accountState = o.accountState === 'member' ? 'member' : 'partner';
  o.kycStatus = o.kycStatus ?? 'verified';
  o.commissionRank = ['Partner', 'Builder', 'Leader', 'Ambassador'].includes(o.commissionRank)
    ? o.commissionRank
    : 'Partner';
  // Canonical role casing (absorbs legacy 'User'/'admin' free-text).
  o.role = lenientRole(o.role);
  // Suspension flag for admin tooling (timestamps stay for audit detail).
  o.suspended = !!o.suspendedAt;
  o.permissions = normalizePermissions(o.permissions);
  return o;
};
