import jwt from 'jsonwebtoken';
import { UnauthorizedException } from '../domain/AppError.js';
import { isSessionRevoked } from '../../modules/identity-access/infrastructure/SessionRevocation.js';

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

export const requireAuth = (req, _res, next) => {
  (async () => {
    try {
      const token = req.cookies?.jwt ?? bearerToken(req);
      if (!token) throw new UnauthorizedException('No authentication token provided');
      const claims = jwt.verify(token, process.env.JWTTOKENSECRET);
      if (!claims?.id) throw new UnauthorizedException('User unauthenticated');
      // Instant kill-switch: suspend / force-sign-out land here on the
      // very next call (one indexed lookup; JWT expiry remains the backstop).
      if (await isSessionRevoked(String(claims.id))) {
        throw new UnauthorizedException('Session revoked — sign in again');
      }
      req.auth = { partnerId: String(claims.id) };
      next();
    } catch (err) {
      if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
        return next(new UnauthorizedException('Invalid or expired token'));
      }
      return next(err);
    }
  })().catch(next);
};

/** Same as requireAuth but never rejects — attaches req.auth when possible. */
export const optionalAuth = (req, _res, next) => {
  try {
    const token = req.cookies?.jwt;
    if (!token) return next();
    const claims = jwt.verify(token, process.env.JWTTOKENSECRET);
    if (claims?.id) req.auth = { partnerId: String(claims.id) };
    return next();
  } catch {
    return next(); // ignore bad/expired token on optional path
  }
};
