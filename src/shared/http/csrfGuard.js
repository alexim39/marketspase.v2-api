import { isAllowedOrigin, originFromReferer } from './origins.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_COOKIES = ['jwt', 'admin_jwt', 'refresh_jwt', 'admin_refresh_jwt'];

/**
 * CSRF defence for cookie-authenticated mutations.
 *
 * Bearer-token requests are exempt (the token is not sent automatically by
 * the browser). Public webhooks have no session cookie and are exempt too.
 * Any request carrying a session cookie must prove it came from an allowed
 * web origin. A custom `X-Requested-With` header is accepted as the
 * programmatic same-origin fallback.
 */
export const csrfGuard = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const bearer = String(req.headers.authorization ?? '');
  if (/^Bearer\s+/i.test(bearer)) return next();

  const hasSession = SESSION_COOKIES.some((name) => Boolean(req.cookies?.[name]));
  if (!hasSession) return next();

  if (String(req.headers['x-requested-with'] ?? '').toLowerCase() === 'xmlhttprequest') {
    return next();
  }

  const origin = req.headers.origin ?? originFromReferer(req.headers.referer);
  if (origin && isAllowedOrigin(origin)) return next();

  return res.status(403).json({
    message: 'This request did not come from a trusted MarketSpase origin.',
    code: 'CSRF_ORIGIN_BLOCKED',
    fix: 'Open the app from the official MarketSpase domain and retry.',
    success: false,
  });
};

export default csrfGuard;
