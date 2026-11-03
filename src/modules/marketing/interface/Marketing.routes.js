import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { GetCampaignRoiUseCase, GetReferralStatsUseCase } from '../application/Marketing.usecases.js';
import { MongoMarketingRepository } from '../infrastructure/Marketing.mongo.repository.js';
import { MongoOutreachSpend } from '../../outreach/infrastructure/Outreach.store.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';

const RoiQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).optional().default(30),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildMarketingRouter = (deps = {}) => {
  const marketing = deps.marketing ?? new MongoMarketingRepository();
  const outreach = deps.outreach ?? new MongoOutreachSpend();
  const roi = new GetCampaignRoiUseCase({ marketing, outreach });
  const network = deps.network ?? new MongoNetworkRepository();
  const partners = deps.partners ?? new MongoPartnerRepository();
  const referrals = deps.referrals ?? new GetReferralStatsUseCase({ network, partners });

  const router = express.Router();
  // Session identity scopes every read — no :partnerId to tamper with.
  router.use(requireAuth);

  router.get('/campaigns/roi', validate({ query: RoiQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await roi.execute({ partnerId: req.auth?.partnerId, days: q?.days });
    res.status(200).json({ message: 'Campaign ROI retrieved successfully', data, success: true });
  }));

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
