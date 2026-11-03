import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { ForbiddenException } from '../../../shared/domain/AppError.js';
import { makeNetworkController } from './Network.controller.js';
import { GetDownlineTreeUseCase, GetPresenceUseCase, GetUplineChainUseCase } from '../application/Network.queries.js';
import { MongoNetworkRepository } from '../infrastructure/Network.mongo.repository.js';
import { collectDownlineIds } from '../infrastructure/Network.mongo.repository.js';
import { lenientRole } from '../../identity-access/domain/PartnerRole.js';
import { adminBootstrapEmails } from '../../identity-access/domain/PartnerRole.js';
import { GetMember360UseCase } from '../../identity-access/application/Member360.usecase.js';
import { ResolveViewAsUseCase } from '../application/Network.viewas.js';
import { recordAudit } from '../../audit/index.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { DepositIntentModel } from '../../billing/infrastructure/Deposit.mongo.model.js';
import { MAX_DEPTH } from '../domain/Network.entity.js';

const PartnerIdParam = z.object({
  partnerId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id'),
});
const DepthQuery = z.object({
  depth: z.coerce.number().int().min(1).max(MAX_DEPTH).optional(),
});
const PresenceBody = z.object({
  ids: z.array(z.string().trim().max(64)).min(1).max(100),
});

/** Admin check mirroring requireRole (presence stays scoped for members). */
const isAdminId = (partners) => async (id) => {
  try {
    const doc = await partners.findById(id);
    if (!doc) return false;
    if (lenientRole(doc.role) === 'admin') return true;
    return adminBootstrapEmails().includes(String(doc.email ?? '').toLowerCase());
  } catch {
    return false;
  }
};

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildNetworkRouter = (deps = {}) => {
  const network = deps.network ?? new MongoNetworkRepository();
  const partners = deps.partners ?? new MongoPartnerRepository();
  const c = makeNetworkController({
    tree: new GetDownlineTreeUseCase({ network }),
    upline: new GetUplineChainUseCase({ network }),
  });
  const presence = deps.presence ?? new GetPresenceUseCase({
    network,
    partners,
    isAdmin: isAdminId(partners),
    downlineIds: (id) => collectDownlineIds(network, id),
  });
  const member360 = deps.member360 ?? new GetMember360UseCase({
    partners,
    transactions: deps.transactions ?? TransactionModel,
    deposits: deps.deposits ?? DepositIntentModel,
    prospects: deps.prospects ?? new MongoProspectRepository(),
    progress: deps.progress ?? new MongoProgressionStore(),
  });

  const router = express.Router();
  // Authenticated: nodes expose only directory-safe fields (no email/phone).
  router.use(requireAuth);
  router.get('/:partnerId/tree', validate({ params: PartnerIdParam, query: DepthQuery }), c.tree);
  router.get('/:partnerId/upline', validate({ params: PartnerIdParam }), c.upline);
  // Bulk presence — lastSeenAt per id, scoped to self/downline/upline
  // (admins see all). Out-of-scope ids resolve null: no existence oracle.
  router.post('/presence', validate({ body: PresenceBody }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await presence.execute({ requesterId: req.auth?.partnerId, ids: body.ids });
    res.status(200).json({ message: 'Presence retrieved successfully', data, success: true });
  }));
  // View-as entry: admin or upline opens a read-only member view.
  // Audited at entry (who looked at whom); the view itself only calls
  // existing subject-scoped reads, so no access rule is widened.
  const viewAs = deps.viewAs ?? new ResolveViewAsUseCase({
    partners, network, audits: { record: (entry) => recordAudit(entry) },
  });
  router.post('/view-as', validate({ body: z.object({ partnerId: PartnerIdParam.shape.partnerId }) }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await viewAs.execute({ requesterId: req.auth?.partnerId, targetId: body.partnerId });
    res.status(200).json({ message: 'Member view opened (read-only)', data, success: true });
  }));
  // Downline 360: upline read-only view reusing the admin 360 shape.
  // Ancestor check keeps it scoped — same pattern as overview targets.
  router.get('/:partnerId/member360', validate({ params: PartnerIdParam }), asyncHandler(async (req, res) => {
    const requesterId = req.auth?.partnerId;
    const targetId = req.validated?.params?.partnerId ?? req.params.partnerId;
    if (String(requesterId) !== String(targetId)) {
      const { ids } = await collectDownlineIds(network, requesterId).catch(() => ({ ids: [] }));
      if (!ids.map(String).includes(String(targetId))) {
        throw new ForbiddenException('You can only view members in your downline');
      }
    }
    const data = await member360.execute({ requesterId, partnerId: targetId });
    res.status(200).json({ message: 'Downline member profile retrieved successfully', data, success: true });
  }));
  return router;
};

export default buildNetworkRouter();
