import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { GetGlobalSearchUseCase } from '../application/Search.usecases.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoCommunityStore } from '../../community/infrastructure/Community.mongo.repository.js';

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(80),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildSearchRouter = (deps = {}) => {
  const search = deps.search ?? new GetGlobalSearchUseCase({
    network: deps.network ?? new MongoNetworkRepository(),
    prospects: deps.prospects ?? new MongoProspectRepository(),
    community: deps.community ?? new MongoCommunityStore(),
  });

  const router = express.Router();
  router.use(requireAuth);

  router.get('/', validate({ query: SearchQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await search.execute({ partnerId: req.auth?.partnerId, q: q?.q });
    res.status(200).json({ message: 'Search completed successfully', data, success: true });
  }));

  return router;
};

export default buildSearchRouter();
