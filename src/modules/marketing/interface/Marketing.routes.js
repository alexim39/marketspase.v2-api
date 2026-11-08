import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { GetReferralStatsUseCase } from '../application/Marketing.usecases.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildMarketingRouter = (deps = {}) => {
  const network = deps.network ?? new MongoNetworkRepository();
  const partners = deps.partners ?? new MongoPartnerRepository();
  const referrals = deps.referrals ?? new GetReferralStatsUseCase({ network, partners });

  const router = express.Router();
  // Session identity scopes every read — no :partnerId to tamper with.
  router.use(requireAuth);

  router.get('/referrals', asyncHandler(async (req, res) => {
    const me = await partners.findById(req.auth?.partnerId).catch(() => null);
    const data = await referrals.execute({
      partnerId: req.auth?.partnerId,
      username: me?.username ?? null,
    });
    res.status(200).json({ message: 'Referral summary retrieved successfully', data, success: true });
  }));

  return router;
};

export default buildMarketingRouter();
