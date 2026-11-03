import express from 'express';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { rateLimit, clientIp } from '../../../shared/http/rateLimit.js';
import { SignupSchema, SigninSchema, ResetRequestSchema, ResetConfirmSchema, VerifyEmailSchema, ResendVerificationSchema } from './Auth.validator.js';
import { makeAuthController } from './Auth.controller.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { SignupUseCase } from '../application/Signup.usecase.js';
import { SigninUseCase } from '../application/Signin.usecase.js';
import { GetCurrentPartnerUseCase } from '../application/GetCurrentPartner.usecase.js';
import { RequestSelfErasureUseCase, CancelSelfErasureUseCase } from '../application/SelfErase.usecase.js';
import { RequestPasswordResetUseCase, ResetPasswordUseCase } from '../application/PasswordReset.usecase.js';
import { VerifyEmailUseCase, ResendVerificationUseCase } from '../application/EmailVerification.usecases.js';
import { MongoPartnerRepository, MongoReservationRepository } from '../infrastructure/Auth.mongo.repository.js';
import { BcryptPasswordHasher, JwtSessionIssuer, EmailVerificationTokens } from '../infrastructure/Auth.crypto.js';
import { PasswordResetMailer } from '../infrastructure/clients/PasswordResetMailer.js';
import { EmailVerificationMailer } from '../infrastructure/clients/EmailVerificationMailer.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { sendEmail } from '../../../services/emailService.js';
import { recordAudit } from '../../audit/index.js';
import { clearRevocations } from '../infrastructure/SessionRevocation.js';
import { runInTransaction } from '../infrastructure/Auth.models.js';

const escMail = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Best-effort erasure-request notices: receipt to the requester, heads-up
 * to their direct upline and to admins. Never fails the request itself —
 * every send is individually caught.
 */
async function notifyErasureRequested(partnerId, data) {
  const me = await PartnersModel.findById(partnerId)
    .select('name surname username email partnerOf').lean().catch(() => null);
  if (!me) return;
  const who = [me.name, me.surname].filter(Boolean).join(' ') || me.username || 'Partner';
  const day = String(data?.scheduledFor ?? '').slice(0, 10);
  const jobs = [];
  if (me.email) {
    jobs.push(sendEmail(
      me.email,
      'Account deletion scheduled',
      `<p>Hi ${escMail(who)},</p>`
      + `<p>Your MarketSpase account is scheduled for deletion on <strong>${escMail(day)}</strong>.</p>`
      + `<p>What happens: your profile is anonymized, your prospects, tickets and codes are deleted, and any remaining wallet balance is forfeited to the ledger. Financial records are retained as required by law.</p>`
      + `<p>Changed your mind? Cancel anytime before then in Settings → Delete my account.</p>`,
    ).catch(() => null));
  }
  const upline = me.partnerOf
    ? await PartnersModel.findById(me.partnerOf).select('name surname email').lean().catch(() => null)
    : null;
  if (upline?.email) {
    const up = [upline.name, upline.surname].filter(Boolean).join(' ') || 'Partner';
    jobs.push(sendEmail(
      upline.email,
      `${who} requested account deletion`,
      `<p>Hi ${escMail(up)},</p>`
      + `<p><strong>${escMail(who)}</strong> requested deletion of their MarketSpase account, scheduled for <strong>${escMail(day)}</strong> (30-day review).</p>`
      + `<p>If they have downline under you, please help reassign those members before then — erasure is blocked while downline remains.</p>`,
    ).catch(() => null));
  }
  const admins = await PartnersModel.find({ role: { $in: ['admin', 'Admin', 'ADMIN'] } })
    .select('email').limit(20).lean().catch(() => []);
  for (const a of admins ?? []) {
    if (!a?.email) continue;
    jobs.push(sendEmail(
      a.email,
      `Erasure requested: ${who}`,
      `<p><strong>${escMail(who)}</strong> (${escMail(me.username ?? '')}) requested account deletion, scheduled for <strong>${escMail(day)}</strong>.</p>`
      + `<p>No action needed unless gates regress — execution re-verifies downline and last-admin before running.</p>`,
    ).catch(() => null));
  }
  await Promise.allSettled(jobs);
}

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildAuthRouter = (deps = {}) => {  const partners = deps.partners ?? new MongoPartnerRepository();
  const reservations = deps.reservations ?? new MongoReservationRepository();
  const hasher = deps.hasher ?? new BcryptPasswordHasher();
  const sessions = deps.sessions ?? new JwtSessionIssuer();
  const tx = deps.tx ?? { runInTransaction };
  const mailer = deps.mailer ?? new PasswordResetMailer();
  const tokens = deps.tokens ?? new EmailVerificationTokens();
  const verificationMailer = deps.verificationMailer ?? new EmailVerificationMailer();
  const frontendUrl = String(
    deps.frontendUrl ?? process.env.FRONTEND_URL ?? process.env.APP_BASE_URL ?? 'https://marketspase.com',
  ).replace(/\/+$/, '');

  const controller = makeAuthController({
    signup: new SignupUseCase({
      partners,
      reservations,
      hasher,
      tx,
      tokens,
      verificationMailer,
      frontendUrl,
    }),
    signin: new SigninUseCase({
      partners, hasher, sessions,
      revocations: deps.revocations ?? { clear: clearRevocations },
    }),
    getCurrentPartner: new GetCurrentPartnerUseCase({ partners }),
    requestPasswordReset: new RequestPasswordResetUseCase({ partners, mailer, frontendUrl }),
    resetPassword: new ResetPasswordUseCase({ partners, hasher }),
    verifyEmail: new VerifyEmailUseCase({ partners, tokens }),
    resendVerification: new ResendVerificationUseCase({
      partners,
      tokens,
      mailer: verificationMailer,
      frontendUrl,
    }),
  });
  // Self-service erasure (GDPR): request/cancel live beside the session they
  // belong to. Wired directly (not via the auth controller) like /ping.
  const requestErasure = deps.requestErasure ?? new RequestSelfErasureUseCase({ partners });
  const cancelErasure = deps.cancelErasure ?? new CancelSelfErasureUseCase({ partners });

  const router = express.Router();
  // Brute-force guard on credential + reset endpoints (per-IP budgets).
  const authLimit = rateLimit({ name: 'auth-attempt', windowMs: 60000, max: 10 });
  const resetLimit = rateLimit({ name: 'auth-reset', windowMs: 60000, max: 5 });
  const verifyLimit = rateLimit({ name: 'auth-verify', windowMs: 60000, max: 10 });
  const resendIpLimit = rateLimit({ name: 'auth-resend-ip', windowMs: 600000, max: 20 });
  const resendLimit = rateLimit({
    name: 'auth-resend',
    windowMs: 600000,
    max: 5,
    key: (req) => `${clientIp(req)}:${String(req.body?.email ?? '').trim().toLowerCase()}`,
  });
  router.post('/signup', authLimit, validate({ body: SignupSchema }), controller.signup);
  router.post('/signin', authLimit, validate({ body: SigninSchema }), controller.signin);
  router.post('/verify-email', verifyLimit, validate({ body: VerifyEmailSchema }), controller.verifyEmail);
  router.post('/resend-verification', resendIpLimit, resendLimit, validate({ body: ResendVerificationSchema }), controller.resendVerification);
  router.post('/signout', controller.signout);
  router.get('/me', requireAuth, controller.me);
  router.get('/', requireAuth, controller.me); // legacy alias for GET /auth
  // Presence heartbeat — the dashboard shell pings every few minutes while
  // open; the write is throttled server-side (see touchPresence), and the
  // admin directory reads it as "Online now" (5-min window).
  router.post('/ping', requireAuth, asyncHandler(async (req, res) => {
    await partners.touchPresence(req.auth?.partnerId).catch(() => false);
    res.status(200).json({ message: 'Presence recorded', success: true });
  }));
  router.post('/reset-password-request', resetLimit, validate({ body: ResetRequestSchema }), controller.requestPasswordReset);
  router.post('/reset-password', validate({ body: ResetConfirmSchema }), controller.resetPassword);
  // Self-service account deletion: rare + email-emitting, so its own hourly budget.
  const erasureLimit = rateLimit({ name: 'auth-erasure', windowMs: 3600000, max: 5 });
  router.post('/me/erasure', requireAuth, erasureLimit, asyncHandler(async (req, res) => {
    const data = await requestErasure.execute({ partnerId: req.auth?.partnerId });
    const day = String(data.scheduledFor).slice(0, 10);
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'account.erase-request',
      targetType: 'partner', targetId: String(req.auth?.partnerId),
      detail: { scheduledFor: data.scheduledFor },
    }).catch(() => null);
    // Best-effort notices — never fail the request itself.
    void notifyErasureRequested(req.auth?.partnerId, data).catch(() => null);
    res.status(200).json({
      message: `Account deletion scheduled for ${day} — cancel anytime before then from Settings.`,
      data, success: true,
    });
  }));
  router.delete('/me/erasure', requireAuth, asyncHandler(async (req, res) => {
    const data = await cancelErasure.execute({ partnerId: req.auth?.partnerId });
    if (data.cancelled) {
      void recordAudit({
        actorId: req.auth?.partnerId, action: 'account.erase-cancel',
        targetType: 'partner', targetId: String(req.auth?.partnerId), detail: {},
      }).catch(() => null);
    }
    res.status(200).json({
      message: data.cancelled ? 'Account deletion cancelled — welcome back.' : 'No deletion was scheduled.',
      data, success: true,
    });
  }));
  return router;
};

export default buildAuthRouter();
