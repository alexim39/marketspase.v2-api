import { ValidationException } from '../../../shared/domain/AppError.js';

export const MAX_DEPTH = 10;
export const DEFAULT_DEPTH = 4;
export const MAX_CHILDREN_PER_NODE = 200;

/**
 * @param {unknown} value
 * @returns {number} clamped depth 1..MAX_DEPTH
 */
export const clampDepth = (value) => {
  const n = Number(value ?? DEFAULT_DEPTH);
  if (!Number.isFinite(n)) throw new ValidationException('Invalid depth');
  return Math.min(Math.max(Math.trunc(n) || DEFAULT_DEPTH, 1), MAX_DEPTH);
};

/** Projected network node — minimal fields, safe to expose to downlines. */
export const toNetworkNode = (doc) => {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  return {
    id: String(o._id),
    username: o.username,
    name: o.name,
    surname: o.surname,
    role: String(o.role ?? 'user').toLowerCase(),
    plan: o.subscription?.plan ?? 'Basic',
    profileImage: o.profileImage ?? null,
    joinedAt: o.createdAt,
  };
};
