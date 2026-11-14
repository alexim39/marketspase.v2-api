import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sessionCookieName } from '../../../shared/http/sessionScope.js';
import { refreshCookieName } from '../infrastructure/RefreshSessions.js';
import { UnauthorizedException } from '../../../shared/domain/AppError.js';

const isProd = () => process.env.NODE_ENV === 'production';
const ACCESS_TTL_MS = Number(process.env.ACCESS_TOKEN_TTL_MS || 15 * 60 * 1000);
const REFRESH_TTL_MS = Number(process.env.REFRESH_TOKEN_TTL_MS || 7 * 24 * 60 * 60 * 1000);

/**
 * Cross-site cookie flags must not depend on NODE_ENV alone. Managed hosts
 * can run the container with NODE_ENV unset (observed on the live API:
 * `/health` reported `development`) — that turned SameSite=None into Lax,
 * so browsers never sent the session or refresh cookie from the SPA origin.
 * Any HTTPS request (direct, proxy header, or HTTPS Origin) is treated as
 * cross-site; plain-http localhost keeps Lax/non-Secure so dev works.
 */
const requestIsHttps = (req) => {
  if (!req) return false;
  if (req.secure) return true;
  const proto = String(req.headers?.['x-forwarded-proto'] ?? '')
    .split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  return /^https:/i.test(String(req.headers?.origin ?? ''));
};

const usesCrossSiteCookies = (req) => isProd() || requestIsHttps(req);

/**
 * Legacy set `secure:true; SameSite=None` unconditionally, which browsers
 * REJECT over plain http://localhost — one cause of the localhost:4200
 * signin pain. Current behavior: cross-site flags for every HTTPS request,
 * localhost-friendly flags otherwise.
 */
export const sessionCookieFlags = (req = null) => ({
  httpOnly: true,
  secure: usesCrossSiteCookies(req),
  sameSite: usesCrossSiteCookies(req) ? 'none' : 'lax',
  maxAge: ACCESS_TTL_MS,
  path: '/',
});

export const refreshCookieFlags = (req = null) => ({
  httpOnly: true,
  secure: usesCrossSiteCookies(req),
  sameSite: usesCrossSiteCookies(req) ? 'none' : 'lax',
  maxAge: REFRESH_TTL_MS,
  path: '/',
});

const scopeOf = (req) => (sessionCookieName(req) === 'admin_jwt' ? 'admin' : 'partner');

/**
 * Explicit body token first, cookie second.
 *
 * Rotation writes a new Set-Cookie on every refresh. Browsers that accept
 * cross-site cookies but block the *response* cookie (common in partitioned
 * or third-party-cookie modes) leave a stale, already-revoked cookie in the
 * jar. Preferring the body token the SPA just received keeps the session
 * alive; the cookie remains the transport for clients that never send a
 * body (and for the very first refresh after an older signin).
 */
const refreshTokenOf = (req, scope) => {
  const bodyToken = req.validated?.body?.refreshToken ?? req.body?.refreshToken;
  if (typeof bodyToken === 'string' && bodyToken.trim()) return bodyToken.trim();
  return req.cookies?.[refreshCookieName(scope)] ?? null;
};

export const makeAuthController = ({
  signup,
  signin,
  getCurrentPartner,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
  resendVerification,
  sessions = null,
  refreshSessions = null,
}) => ({
  signup: asyncHandler(async (req, res) => {
    const { user, verificationSent } = await signup.execute(req.validated?.body ?? req.body);
    res.status(200).json({
      userObject: user,
      message: verificationSent
        ? 'Account created. Check your email to verify your account before signing in.'
        : 'Account created, but we could not send the verification email. Open the sign-in page and request a new verification link.',
      success: true,
      verificationSent: verificationSent === true,
    });
  }),

  signin: asyncHandler(async (req, res) => {
    const { token, user } = await signin.execute({
      ...(req.validated?.body ?? req.body),
      ip: req.ip ?? req.headers?.['x-forwarded-for'] ?? null,
      agent: req.headers?.['user-agent'] ?? null,
    });
    const scope = scopeOf(req);
    res.cookie(sessionCookieName(req), token, sessionCookieFlags(req));
    let refreshToken = null;
    if (refreshSessions) {
      const partnerId = String(user?.id ?? user?._id ?? '');
      if (partnerId) {
        const refresh = await refreshSessions.issue({
          partnerId,
          scope,
          ip: req.ip ?? null,
          userAgent: req.headers?.['user-agent'] ?? null,
        }).catch(() => null);
        if (refresh) {
          refreshToken = refresh.token;
          res.cookie(refreshCookieName(scope), refresh.token, refreshCookieFlags(req));
        }
      }
    }
    // Legacy shape preserved; `data` is additive for new clients.
    // `token` ships in the body as a fallback transport: cross-site
    // third-party-cookie blocking can drop the Set-Cookie while the login
    // itself succeeds — the SPA then replays it as `Authorization: Bearer`
    // (see requireAuth), so sessions survive without the cookie.
    // `refreshToken` covers the same gap for silent refresh; the SPA keeps
    // it only as a fallback and clears it on sign-out.
    res.status(200).json({
      message: 'Login successful',
      success: true,
      data: { user, token, refreshToken },
    });
  }),

  refresh: asyncHandler(async (req, res) => {
    if (!refreshSessions || !sessions) {
      throw new UnauthorizedException('Session refresh is not available');
    }
    const scope = scopeOf(req);
    const token = refreshTokenOf(req, scope);
    const rotated = await refreshSessions.rotate({
      token,
      scope,
      ip: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    const user = await getCurrentPartner.execute({ partnerId: rotated.partnerId });
    const accessToken = sessions.sign(rotated.partnerId);
    res.cookie(sessionCookieName(req), accessToken, sessionCookieFlags(req));
    res.cookie(refreshCookieName(scope), rotated.token, refreshCookieFlags(req));
    res.status(200).json({
      message: 'Session refreshed',
      success: true,
      data: { user, token: accessToken, refreshToken: rotated.token },
    });
  }),

  signout: asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const token = refreshTokenOf(req, scope);
    if (refreshSessions) await refreshSessions.revoke({ token, scope }).catch(() => null);
    res.cookie(sessionCookieName(req), '', { ...sessionCookieFlags(req), maxAge: 0 });
    res.cookie(refreshCookieName(scope), '', { ...refreshCookieFlags(req), maxAge: 0 });
    res.status(200).json({ message: 'Logged out successfully', success: true });
  }),

  me: asyncHandler(async (req, res) => {
    const data = await getCurrentPartner.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ data, message: 'User authenticated', success: true });
  }),

  requestPasswordReset: asyncHandler(async (req, res) => {
    await requestPasswordReset.execute(req.validated?.body ?? req.body);
    // Generic message either way — anti-enumeration (legacy 404'd unknown emails).
    res.status(200).json({ message: 'If an account exists for that email, a reset link was sent.', success: true });
  }),

  resetPassword: asyncHandler(async (req, res) => {
    const result = await resetPassword.execute(req.validated?.body ?? req.body);
    res.status(200).json({ ...result, success: true });
  }),

  verifyEmail: asyncHandler(async (req, res) => {
    const data = await verifyEmail.execute(req.validated?.body ?? req.body);
    res.status(200).json({ ...data, success: true });
  }),

  resendVerification: asyncHandler(async (req, res) => {
    await resendVerification.execute(req.validated?.body ?? req.body);
    res.status(200).json({
      message: 'If that email needs verification, a new verification link has been sent.',
      success: true,
    });
  }),
});
