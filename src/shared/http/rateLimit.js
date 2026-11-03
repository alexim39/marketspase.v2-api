/**
 * Per-IP sliding-window rate limiter (in-memory, per process).
 * Covers intentionally-public surfaces (survey/ticket/contact submits,
 * visit recording, username lookups) plus auth endpoints (brute force).
 * Authenticated API abuse is account-bound and handled by ownership
 * guards instead — this is purely an anonymous-flood control.
 *
 * Multi-instance note: buckets live per process. Behind N replicas an
 * attacker gets N× the budget — acceptable for flood control (not for
 * billing); upgrade to Redis only if abuse demands it.
 */
const buckets = new Map();

const sweep = () => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
};

let sweptAt = 0;

/** Client IP behind proxies (no trust-proxy change required). */
export const clientIp = (req) =>
  String(req.headers?.['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim() || req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * @param {{name, windowMs, max, key?}} opts (`name` namespaces buckets per route)
 * 429s with Retry-After + RATE_LIMITED envelope when exceeded.
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
