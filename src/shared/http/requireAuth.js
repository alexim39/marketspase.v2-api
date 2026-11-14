import jwt from 'jsonwebtoken';
import { UnauthorizedException } from '../domain/AppError.js';
import { isSessionRevoked } from '../../modules/identity-access/infrastructure/SessionRevocation.js';
import { sessionCookieName } from './sessionScope.js';

/**
 * Decoupled auth middleware (Infrastructure/Interface boundary).
 * Verifies the `jwt` cookie and injects `req.auth = { partnerId }`.
 * Use-cases receive a plain `partnerId` string — they never
 * touch cookies, headers, or `jsonwebtoken`.
 *
 * Fallback transport: `Authorization: Bearer <jwt>` when the cookie is
 * absent. Cross-site third-party-cookie blocking can drop the Set-Cookie
 * while login succeeds — the SPA replays the token from the signin body
 * (cookie stays primary; header only fills the gap).
 *
 * A cookie that no longer verifies (blocked refresh of the Set-Cookie,
 * rotation, clock skew) must not mask a valid Bearer token: both are
 * tried, cookie first. This is what keeps the session alive when the
 * browser keeps sending a stale `jwt` cookie and ignores its replacement.
 *
 * For the ticket slice this is OPTIONAL (legacy clients send
 * `partnerId` in the body). New clients should send the cookie
 * and may omit `partnerId` — the controller prefers auth.
 */
export const bearerToken = (req) => {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
};

/** Partner id from a token, or null when it is missing/invalid/expired. */
const verifiedPartnerId = (token) => {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, process.env.JWTTOKENSECRET);
    return claims?.id ? String(claims.id) : null;
  } catch {
    return null;
  }
};

const sessionCredentials = (req) => [
  req.cookies?.[sessionCookieName(req)],
  bearerToken(req),
].filter(Boolean);

/** First credential that verifies, cookie before header. */
const firstVerifiedPartnerId = (tokens) => {
  for (const token of tokens) {
    const partnerId = verifiedPartnerId(token);
    if (partnerId) return partnerId;
  }
  return null;
};

export const requireAuth = (req, _res, next) => {
  (async () => {
    try {
      const credentials = sessionCredentials(req);
      if (credentials.length === 0) {
        throw new UnauthorizedException('No authentication token provided');
      }
      const partnerId = firstVerifiedPartnerId(credentials);
      if (!partnerId) throw new UnauthorizedException('Invalid or expired token');
      // Instant kill-switch: suspend / force-sign-out land here on the
      // very next call (one indexed lookup; JWT expiry remains the backstop).
      if (await isSessionRevoked(partnerId)) {
        throw new UnauthorizedException('Session revoked — sign in again');
      }
      req.auth = { partnerId };
      next();
    } catch (err) {
      next(err);
    }
  })().catch(next);
};

/** Same as requireAuth but never rejects — attaches req.auth when possible. */
export const optionalAuth = (req, _res, next) => {
  const partnerId = firstVerifiedPartnerId(sessionCredentials(req));
  if (partnerId) req.auth = { partnerId };
  return next();
};
