import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sessionCookieName } from '../../../shared/http/sessionScope.js';

const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Legacy set `secure:true; SameSite=None` unconditionally, which browsers
 * REJECT over plain http://localhost — one cause of the localhost:4200
 * signin pain. New behavior: strict in prod, localhost-friendly in dev.
 */
export const sessionCookieFlags = () => ({
  httpOnly: true,
  secure: isProd(),
  sameSite: isProd() ? 'none' : 'lax',
  maxAge: 24 * 60 * 60 * 1000,
  path: '/',
});

export const makeAuthController = ({
  signup,
  signin,
  getCurrentPartner,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
  resendVerification,
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
    res.cookie(sessionCookieName(req), token, sessionCookieFlags());
    // Legacy shape preserved; `data` is additive for new clients.
    // `token` ships in the body as a fallback transport: cross-site
    // third-party-cookie blocking can drop the Set-Cookie while the login
    // itself succeeds — the SPA then replays it as `Authorization: Bearer`
    // (see requireAuth), so sessions survive without the cookie.
    res.status(200).json({ message: 'Login successful', success: true, data: { user, token } });
  }),

  signout: asyncHandler(async (req, res) => {
    res.cookie(sessionCookieName(req), '', { ...sessionCookieFlags(), maxAge: 0 });
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
