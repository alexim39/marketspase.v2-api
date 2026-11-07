import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { rateLimit, userKey } from '../../../shared/http/rateLimit.js';
import { idempotency } from '../../../shared/http/idempotency.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { recordAudit } from '../../audit/index.js';
import { logger } from '../../../shared/observability/logger.js';
import {
  AdminCreditWalletUseCase, DecideManualDepositUseCase, ListManualQueueUseCase,
  LookupPartnerUseCase, MyManualClaimsUseCase,
  InitDepositUseCase, HandleDepositCallbackUseCase, DepositStatusUseCase,
} from '../application/Deposit.usecases.js';
import { OpayClient, OPAY_TEST_BASE, OPAY_LIVE_BASE } from '../infrastructure/OpayClient.js';
import { PaystackClient } from '../infrastructure/PaystackClient.js';
import {
  InitPaystackDepositUseCase, HandlePaystackWebhookUseCase, PaystackDepositStatusUseCase,
} from '../application/PaystackDeposit.usecases.js';
import { HandlePaystackTransferUseCase } from '../application/PaystackPayout.usecases.js';
import { notifyPayoutOutcome } from '../application/Payout.notifier.js';
import { StoreOrderRepository } from '../../stores/infrastructure/StoreOrder.mongo.repository.js';
import { NotifyUseCase } from '../../notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import {
  ADMIN_CREDIT_MAX_NGN, DEPOSIT_MAX_NGN, DEPOSIT_MIN_NGN,
} from '../domain/Deposit.js';

const objectIdParam = z.string().trim().min(1).max(64);

const DecideSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional().default(''),
});

const CreditSchema = z.object({
  partnerId: objectIdParam,
  amountNgn: z.number().positive().max(ADMIN_CREDIT_MAX_NGN),
  reason: z.string().trim().min(5).max(500),
});

const LookupQuery = z.object({ q: z.string().trim().min(2).max(120) });
const QueueQuery = z.object({
  status: z.enum(['awaiting-review', 'approved', 'rejected', 'all']).optional().default('awaiting-review'),
});
const RefParam = z.object({ reference: z.string().trim().min(4).max(64) });

const InitSchema = z.object({
  amountNgn: z.number().min(DEPOSIT_MIN_NGN).max(DEPOSIT_MAX_NGN),
  email: z.string().trim().email().max(254).optional(),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
});

const StatusQuery = z.object({
  reference: z.string().trim().min(1).max(64),
});

/** Mode-aware Opay config: OPAY_MODE=live selects LIVE_* keys, default test.
 * Legacy single OPAY_PUBLIC_KEY / OPAY_PRIVATE_KEY / OPAY_BASE_URL kept as
 * fallback so older envs keep working. Pure — unit-tested, no I/O. */
export const resolveOpayConfig = (env = process.env) => {
  const live = String(env.OPAY_MODE ?? 'test').toLowerCase() === 'live';
  const conf = live
    ? {
        baseUrl: env.OPAY_LIVE_BASE || OPAY_LIVE_BASE,
        publicKey: env.OPAY_LIVE_PUBLIC_KEY || '',
        privateKey: env.OPAY_LIVE_PRIVATE_KEY || '',
      }
    : {
        baseUrl: env.OPAY_TEST_BASE || OPAY_TEST_BASE,
        publicKey: env.OPAY_TEST_PUBLIC_KEY || '',
        privateKey: env.OPAY_TEST_PRIVATE_KEY || '',
      };
  if (!conf.publicKey) conf.publicKey = env.OPAY_PUBLIC_KEY || '';
  if (!conf.privateKey) conf.privateKey = env.OPAY_PRIVATE_KEY || '';
  if (env.OPAY_BASE_URL) conf.baseUrl = env.OPAY_BASE_URL;
  conf.merchantId = env.OPAY_MERCHANT_ID || '';
  conf.mode = live ? 'live' : 'test';
  return conf;
};

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildDepositRouter = (deps = {}) => {
  const conf = resolveOpayConfig();
  const opay = deps.opay ?? new OpayClient(conf);
  const paystack = deps.paystack ?? new PaystackClient({ http: deps.http });
  const frontendBase = (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'https://marketspase.com').replace(/\/+$/, '');
  const notifyStore = new MongoStoredNotificationStore();
  const notify = new NotifyUseCase({ stored: notifyStore });
  const notifyCredit = (label) => async (partnerId, amountNgn, reference) => {
    await notify.execute({
      recipientId: String(partnerId),
      category: 'system',
      priority: 'high',
      title: `Wallet credited ₦${Number(amountNgn).toLocaleString()}`,
      body: `Your ${label} (${reference}) is confirmed.`,
      icon: 'account_balance_wallet',
      link: '/dashboard/wallet/history',
      key: `deposit:${reference}`,
    });
  };
  const notifyReject = async (partnerId, amountNgn, reference, reason) => {
    await notify.execute({
      recipientId: String(partnerId),
      category: 'system',
      priority: 'high',
      title: 'Deposit claim was not confirmed',
      body: `Your ₦${Number(amountNgn).toLocaleString()} transfer claim (${reference}) was not confirmed: ${reason}. Contact support if this looks wrong.`,
      icon: 'account_balance_wallet',
      link: '/dashboard/wallet/deposit',
      key: `deposit-reject:${reference}`,
    });
  };

  const init = deps.init ?? new InitDepositUseCase({
    opay,
    urls: {
      callbackUrl: process.env.OPAY_CALLBACK_URL || undefined,
      returnUrl: `${frontendBase}/dashboard/wallet/deposit/result`,
      cancelUrl: `${frontendBase}/dashboard/wallet/deposit`,
    },
  });
  const callback = deps.callback ?? new HandleDepositCallbackUseCase({
    opay,
    privateKey: conf.privateKey,
    notifier: notifyCredit('Opay deposit'),
  });
  const paystackInit = deps.paystackInit ?? new InitPaystackDepositUseCase({
    paystack,
    urls: { returnUrl: `${frontendBase}/dashboard/wallet/deposit/result` },
  });
  const paystackTransferWebhook = deps.paystackTransferWebhook ?? new HandlePaystackTransferUseCase({
    notifier: notifyPayoutOutcome,
  });
  const storeOrderWebhook = deps.storeOrderWebhook
    ?? new StoreOrderRepository({ paystack });
  const paystackWebhook = deps.paystackWebhook ?? new HandlePaystackWebhookUseCase({
    paystack,
    notifier: notifyCredit('Paystack deposit'),
    transferHandler: paystackTransferWebhook,
    storeOrderHandler: storeOrderWebhook,
  });
  const paystackStatus = deps.paystackStatus ?? new PaystackDepositStatusUseCase({
    paystack,
    notifier: notifyCredit('Paystack deposit'),
  });
  const status = deps.status ?? new DepositStatusUseCase({ opay, paystackStatus });

  // Method registry: adding a gateway (e.g. Paystack) = one entry here +
  // its handler — the deposit page renders whatever this lists.
  const methods = () => ([
    {
      id: 'paystack',
      kind: 'gateway',
      label: 'Card or bank payment',
      detail: 'Secure Paystack checkout — card, bank transfer or USSD.',
      enabled: paystack.enabled,
    },
    {
      id: 'opay',
      kind: 'gateway',
      label: 'Pay with Opay',
      detail: 'Card, transfer or USSD through Opay secure checkout.',
      enabled: opay.enabled,
    },
  ]);
  const myClaims = deps.myClaims ?? new MyManualClaimsUseCase({});
  const queue = deps.queue ?? new ListManualQueueUseCase({});
  const decide = deps.decide ?? new DecideManualDepositUseCase({
    notifier: notifyCredit('Manual Transfer'),
    rejectNotifier: notifyReject,
  });
  const credit = deps.credit ?? new AdminCreditWalletUseCase({ notifier: notifyCredit('Admin Credit') });
  const lookup = deps.lookup ?? new LookupPartnerUseCase({});

  const router = express.Router();
  const depositInitLimit = rateLimit({
    name: 'billing-deposit-init',
    windowMs: 3600000,
    max: 10,
    key: userKey,
  });

  router.post('/deposit/init', requireAuth, depositInitLimit, validate({ body: InitSchema }), idempotency(), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await init.execute({
      partnerId: req.auth?.partnerId,
      amountNgn: body.amountNgn,
      contact: { email: body.email, name: body.name, phone: body.phone },
    });
    void recordAudit({
      actorId: req.auth?.partnerId,
      action: 'wallet.deposit.init',
      targetType: 'deposit',
      targetId: data.reference,
      detail: { provider: 'opay', amountNgn: data.amountNgn ?? body.amountNgn, requestId: req.id },
    });
    logger.info('money_action', {
      action: 'wallet.deposit.init', provider: 'opay', partnerId: req.auth?.partnerId,
      amountNgn: data.amountNgn ?? body.amountNgn, reference: data.reference, requestId: req.id,
    });
    res.status(200).json({
      message: 'Checkout opened — complete payment with Opay',
      data,
      meta: {
        next_steps: {
          reference: data.reference,
          action: 'complete_payment',
          checkout_url: data.cashierUrl,
          expires_in_minutes: data.expiresInMinutes ?? null,
        },
      },
      success: true,
    });
  }));

  router.post('/deposit/paystack/init', requireAuth, depositInitLimit, validate({ body: InitSchema }), idempotency(), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await paystackInit.execute({
      partnerId: req.auth?.partnerId,
      amountNgn: body.amountNgn,
      contact: { email: body.email, name: body.name, phone: body.phone },
    });
    void recordAudit({
      actorId: req.auth?.partnerId,
      action: 'wallet.deposit.init',
      targetType: 'deposit',
      targetId: data.reference,
      detail: { provider: 'paystack', amountNgn: data.amountNgn ?? body.amountNgn, requestId: req.id },
    });
    logger.info('money_action', {
      action: 'wallet.deposit.init', provider: 'paystack', partnerId: req.auth?.partnerId,
      amountNgn: data.amountNgn ?? body.amountNgn, reference: data.reference, requestId: req.id,
    });
    res.status(200).json({
      message: 'Checkout opened — complete payment with Paystack',
      data,
      meta: {
        next_steps: {
          reference: data.reference,
          action: 'complete_payment',
          checkout_url: data.checkoutUrl,
          expires_in_minutes: data.expiresInMinutes ?? null,
        },
      },
      success: true,
    });
  }));

  router.get('/deposit/status', requireAuth, validate({ query: StatusQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await status.execute({ partnerId: req.auth?.partnerId, reference: q.reference });
    res.status(200).json({ message: 'Deposit status retrieved successfully', data, success: true });
  }));

  // PUBLIC Opay webhook — signature-verified inside the usecase, always 200
  // on handled outcomes (Opay retries non-2xx for 72h; only unknown
  // references and bad signatures 4xx, which must NOT be retried).
  router.post('/deposit/callback', asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    try {
      const data = await callback.execute({ payload: body.payload ?? null, sha512: body.sha512 ?? null });
      if (data?.status === 'success' && !data?.deduped) {
        void recordAudit({
          actorId: 'system:opay',
          action: 'wallet.deposit.credit',
          targetType: 'deposit',
          targetId: data.reference ?? null,
          detail: { provider: 'opay', amountNgn: data.amountNgn ?? null, balanceAfter: data.balance ?? null, requestId: req.id },
        });
        logger.info('money_action', {
          action: 'wallet.deposit.credit', provider: 'opay', partnerId: data.partnerId ?? null,
          amountNgn: data.amountNgn ?? null, reference: data.reference ?? null,
          balanceAfter: data.balance ?? null, requestId: req.id,
        });
      }
      res.status(200).json({ message: 'Callback handled', data, success: true });
    } catch (err) {
      if (err?.code === 'BAD_SIGNATURE' || err?.code === 'UNKNOWN_REFERENCE') {
        return res.status(400).json({ message: err.message, success: false, code: err.code });
      }
      throw err;
    }
  }));

  // PUBLIC Paystack webhook — HMAC-verified against the raw request body.
  // One endpoint handles both money directions:
  //   charge.success   → wallet deposit credit
  //   transfer.success → withdrawal marked Paid
  //   transfer.failed / transfer.reversed → withdrawal rejected + refunded
  const handlePaystackWebhook = asyncHandler(async (req, res) => {
    try {
      const data = await paystackWebhook.execute({
        payload: req.body ?? {},
        rawBody: req.rawBody,
        signature: req.get('x-paystack-signature'),
      });
      if (data?.status === 'success' && !data?.deduped) {
        void recordAudit({
          actorId: 'system:paystack',
          action: 'wallet.deposit.credit',
          targetType: 'deposit',
          targetId: data.reference ?? null,
          detail: { provider: 'paystack', amountNgn: data.amountNgn ?? null, balanceAfter: data.balance ?? null, requestId: req.id },
        });
        logger.info('money_action', {
          action: 'wallet.deposit.credit', provider: 'paystack', partnerId: data.partnerId ?? null,
          amountNgn: data.amountNgn ?? null, reference: data.reference ?? null,
          balanceAfter: data.balance ?? null, requestId: req.id,
        });
      }
      res.status(200).json({ message: 'Webhook handled', data, success: true });
    } catch (err) {
      if (err?.code === 'BAD_SIGNATURE' || err?.code === 'UNKNOWN_REFERENCE' || err?.code === 'AMOUNT_MISMATCH') {
        return res.status(400).json({ message: err.message, success: false, code: err.code });
      }
      throw err;
    }
  });
  router.post('/deposit/paystack/webhook', handlePaystackWebhook);
  // Unified alias for a cleaner dashboard configuration.
  router.post('/paystack/webhook', handlePaystackWebhook);

  // Method registry for the deposit page (extensible: new gateways appear here).
  router.get('/deposit/methods', requireAuth, asyncHandler(async (_req, res) => {
    res.status(200).json({ message: 'Deposit methods retrieved successfully', data: methods(), success: true });
  }));

  // Manual-transfer claim (no money moves — waits for admin review).
  // Manual bank-transfer deposits are retired: the three receiving accounts
  // are no longer advertised or accepted. Historical claims remain readable
  // by admins below.
  router.post('/deposit/manual', requireAuth, asyncHandler(async (_req, res) => {
    res.status(410).json({
      message: 'Manual bank-transfer deposits are no longer available — use card or bank payment.',
      code: 'MANUAL_DEPOSIT_RETIRED',
      success: false,
    });
  }));

  router.get('/deposit/manual/mine', requireAuth, asyncHandler(async (req, res) => {
    const data = await myClaims.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Manual deposits retrieved successfully', data, success: true });
  }));

  // Admin review queue.
  router.get('/deposit/manual/queue', requireAuth, requireRole('admin'), validate({ query: QueueQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await queue.execute({ status: q.status });
    res.status(200).json({ message: 'Manual deposit queue retrieved successfully', data, success: true });
  }));

  router.post('/deposit/manual/:reference/decide', requireAuth, requireRole('admin'), validate({ params: RefParam, body: DecideSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await decide.execute({
      reference: params.reference,
      adminId: req.auth?.partnerId,
      decision: body.decision,
      note: body.note,
    });
    void recordAudit({
      actorId: req.auth?.partnerId, action: `deposit.manual.${body.decision}`,
      targetType: 'deposit', targetId: data.reference,
      detail: { amount: data.amountNgn, note: body.note || null },
    });
    res.status(200).json({ message: body.decision === 'approve' ? 'Claim approved — wallet credited' : 'Claim rejected', data, success: true });
  }));

  // Admin wallet tools.
  router.get('/admin/wallet/lookup', requireAuth, requireRole('admin'), validate({ query: LookupQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await lookup.execute({ q: q.q });
    res.status(200).json({ message: 'Partner lookup completed', data, success: true });
  }));

  router.post('/admin/wallet/credit', requireAuth, requireRole('admin'), validate({ body: CreditSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await credit.execute({
      adminId: req.auth?.partnerId,
      partnerId: body.partnerId,
      amountNgn: body.amountNgn,
      reason: body.reason,
    });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'wallet.credit',
      targetType: 'partner', targetId: String(body.partnerId),
      detail: { amount: data.amountNgn, reason: body.reason, reference: data.reference },
    });
    res.status(200).json({ message: 'Wallet credited', data, success: true });
  }));

  return router;
};

export default buildDepositRouter();
