/**
 * Per-key sliding-window rate limiter (in-memory, per process).
 *
 * Covers intentionally-public surfaces (survey/ticket/contact submits,
 * visit recording, username lookups) plus auth, listing and money actions.
 * `key` defaults to the trusted Express client IP. Behind a proxy set
 * `TRUST_PROXY_HOPS=1` so Express derives `req.ip` correctly; never trust a
 * raw `X-Forwarded-For` header.
 *
 * Multi-instance note: buckets live per process. For auth and money actions
 * the caller should attach a user key; a Mongo-backed counter can replace
 * this adapter later without changing route code.
 */
const buckets = new Map();

const sweep = () => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
};

let sweptAt = 0;

/** Client IP derived by Express (honours `trust proxy` when configured). */
export const clientIp = (req) =>
  req.ip || req.socket?.remoteAddress || 'unknown';

/** Stable per-user key; falls back to the IP for anonymous requests. */
export const userKey = (req) =>
  req.auth?.partnerId ? `user:${req.auth.partnerId}` : `ip:${clientIp(req)}`;

/**
 * @param {{name, windowMs, max, key?}} opts (`name` namespaces buckets per route)
 * 429s with Retry-After + a JSON `retry_after` field.
 */
export const rateLimit = ({ name = 'default', windowMs = 60000, max = 30, key = null } = {}) => {
  const limit = Math.max(1, Number(max) || 30);
  const window = Math.max(1000, Number(windowMs) || 60000);
  return (req, res, next) => {
    try {
      const now = Date.now();
      if (now - sweptAt > window) {
        sweptAt = now;
        sweep();
      }
      const id = key ? key(req) : `${clientIp(req)}`;
      const bucketKey = `${name}:${id}`;
      let entry = buckets.get(bucketKey);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + window };
        buckets.set(bucketKey, entry);
      }
      entry.count += 1;
      if (entry.count > limit) {
        const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        res.set?.('Retry-After', String(retryAfter));
        return res.status(429).json({
          message: 'Too many requests — please slow down and try again shortly.',
          success: false,
          code: 'RATE_LIMITED',
          fix: `Wait ${retryAfter} second${retryAfter === 1 ? '' : 's'}, then retry once.`,
          retry_after: retryAfter,
        });
      }
      return next();
    } catch {
      return next();
    }
  };
};

/** Test seam: reset all buckets. */
export const resetRateLimits = () => {
  buckets.clear();
  sweptAt = 0;
};
