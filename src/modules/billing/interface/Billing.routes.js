import axios from 'axios';
import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { rateLimit, userKey } from '../../../shared/http/rateLimit.js';
import { mongoRateLimit } from '../../../shared/http/mongoRateLimit.js';
import { idempotency } from '../../../shared/http/idempotency.js';
import { makeBillingController } from './Billing.controller.js';
import { ResolveAccountUseCase, ListBanksUseCase } from '../application/Commission.queries.js';
import { CreateWithdrawalUseCase, MIN_WITHDRAWAL_NGN, MAX_WITHDRAWAL_NGN } from '../application/Withdrawal.usecases.js';
import { PaystackClient } from '../infrastructure/PaystackClient.js';
import { notifyPayoutOutcome } from '../application/Payout.notifier.js';

const ResolveQuery = z.object({
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Invalid account number'),
  bankCode: z.string().trim().min(1).max(20),
});
const WithdrawalSchema = z.object({
  bankCode: z.string().trim().min(1).max(20),
  bankName: z.string().trim().max(120).optional(),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Invalid account number'),
  amountNgn: z.number().min(MIN_WITHDRAWAL_NGN).max(MAX_WITHDRAWAL_NGN),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildBillingRouter = (deps = {}) => {
  const paystack = deps.paystack ?? new PaystackClient({ http: deps.http });
  const autoPayout = deps.autoPayout ?? process.env.PAYSTACK_AUTO_PAYOUT !== 'false';

  const c = makeBillingController({
    resolveAccount: new ResolveAccountUseCase({ http: deps.http ?? axios }),
    listBanks: new ListBanksUseCase({ http: deps.http ?? axios }),
    createWithdrawal: new CreateWithdrawalUseCase({ paystack, notifier: notifyPayoutOutcome, autoPayout }),
  });

  const router = express.Router();
  router.use(requireAuth);
  const withdrawalLimit = rateLimit({
    name: 'billing-withdrawal',
    windowMs: 3600000,
    max: 5,
    key: userKey,
  });
  const withdrawalHourLimit = mongoRateLimit({
    name: 'billing-withdrawal',
    windowMs: 3600000,
    max: 5,
    key: userKey,
  });

  // Bank account holder lookup — proxied so the Paystack secret never ships to clients.
  router.get('/resolve-account', validate({ query: ResolveQuery }), c.resolveAccount);
  // Bank directory — proxied so the browser never calls Paystack directly.
  router.get('/banks', c.listBanks);
  // Withdrawal request — account name is re-resolved server-side.
  router.post('/withdrawals', withdrawalLimit, withdrawalHourLimit, validate({ body: WithdrawalSchema }), idempotency(), c.createWithdrawal);
  return router;
};

export default buildBillingRouter();
