import axios from 'axios';
import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { makeBillingController } from './Billing.controller.js';
import {
  AccrueCommissionsUseCase, ReleaseCartCommissionsUseCase, VoidCartCommissionsUseCase,
} from '../application/Commission.commands.js';
import {
  GetEarningsTrendUseCase, GetMyCommissionsUseCase, GetPendingCartsUseCase, GetPerformanceUseCase,
  ResolveAccountUseCase,
} from '../application/Commission.queries.js';
import { GetPlanUseCase, UpdatePlanUseCase } from '../application/Commission.plan.js';
import { MongoCommissionLedger, MongoOrderReader } from '../infrastructure/Billing.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const CartIdParam = z.object({ cartId: objectId });
const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  skip: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(['Pending', 'Released', 'Voided', 'Reversed']).optional(),
});
const TrendsQuery = z.object({
  months: z.coerce.number().int().min(2).max(12).optional().default(6),
});
const ResolveQuery = z.object({
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Invalid account number'),
  bankCode: z.string().trim().min(1).max(20),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildBillingRouter = (deps = {}) => {
  const ledger = deps.ledger ?? new MongoCommissionLedger();
  const orders = deps.orders ?? new MongoOrderReader();
  const network = deps.network ?? new MongoNetworkRepository();
  const partners = deps.partners ?? new MongoPartnerRepository();

  const c = makeBillingController({
    mine: new GetMyCommissionsUseCase({ ledger }),
    performance: new GetPerformanceUseCase({ ledger, orders, network, partners }),
    trends: new GetEarningsTrendUseCase({ ledger }),
    resolveAccount: new ResolveAccountUseCase({ http: deps.http ?? axios }),
    accrue: new AccrueCommissionsUseCase({ ledger, orders, network }),
    pendingCarts: new GetPendingCartsUseCase({ ledger }),
    release: new ReleaseCartCommissionsUseCase({ ledger, orders }),
    void: new VoidCartCommissionsUseCase({ ledger, orders }),
    plan: new GetPlanUseCase({ ledger }),
    updatePlan: new UpdatePlanUseCase({ ledger }),
  });

  const router = express.Router();
  router.use(requireAuth);

  // Earner self-service (own session identity — no :partnerId to tamper with).
  router.get('/mine', validate({ query: PageQuery }), c.mine);
  router.get('/performance', validate({ query: z.object({}) }), c.summary);
  router.get('/trends', validate({ query: TrendsQuery }), c.trends);
  // Bank account holder lookup — proxied so the Paystack secret never ships to clients.
  router.get('/resolve-account', validate({ query: ResolveQuery }), c.resolveAccount);
  // Called by checkout after legacy order success (idempotent on retry).
  router.post('/accrue/:cartId', validate({ params: CartIdParam }), c.accrue);

  // Admin fulfillment console.
  router.get('/pending-carts', requireRole('admin'), validate({ query: PageQuery }), c.pendingCarts);
  router.post('/release/:cartId', requireRole('admin'), validate({ params: CartIdParam }), c.release);
  router.post('/void/:cartId', requireRole('admin'), validate({ params: CartIdParam }), c.void);

  // Commission plan — readable by any partner, writable by admins only.
  // New rates apply to future accrues; settled entries are never rewritten.
  router.get('/plan', c.plan);
  router.put('/plan', requireRole('admin'), validate({
    body: z.object({
      rates: z.array(z.number().min(0).max(1)).min(1).max(5),
      name: z.string().trim().max(120).optional(),
    }),
  }), c.updatePlan);
  return router;
};

export default buildBillingRouter();
