import express from 'express';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from './RequireRole.js';
import { z } from 'zod';
import { ROLES } from '../domain/PartnerRole.js';
import { makeAdminController } from './Admin.controller.js';
import { ListPartnersUseCase, SetPartnerRoleUseCase, SetSuspendUseCase, PlatformStatsUseCase, ResetOnBehalfUseCase, ErasePartnerUseCase, ReassignUplineUseCase } from '../application/Admin.usecase.js';
import { GetMember360UseCase } from '../application/Member360.usecase.js';
import { RequestPasswordResetUseCase } from '../application/PasswordReset.usecase.js';
import { PasswordResetMailer } from '../infrastructure/clients/PasswordResetMailer.js';
import { MongoPartnerRepository } from '../infrastructure/Auth.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoTicketRepository } from '../../support-ticketing/infrastructure/Ticket.mongo.repository.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { DepositIntentModel } from '../../billing/infrastructure/Deposit.mongo.model.js';
import { revokeSessions, clearRevocations } from '../infrastructure/SessionRevocation.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const PartnerIdParam = z.object({ partnerId: objectId });
const SetRoleSchema = z.object({
  role: z.string().trim().toLowerCase().refine((v) => ROLES.includes(v), {
    message: `Invalid role (expected one of: ${ROLES.join(', ')})`,
  }),
});
const AdminListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  skip: z.coerce.number().int().min(0).optional().default(0),
  q: z.string().trim().max(120).optional().default(''),
  role: z.enum([...ROLES, 'all']).optional().default('all'),
  // `all` | `yes` | `no` — plain enum avoids z.coerce.boolean's
  // non-empty-string-is-true trap ('false' would coerce to true).
  suspended: z.enum(['all', 'yes', 'no']).optional().default('all'),
  // Engagement window: `dormant30` (no login in 30d incl. never-seen),
  // `new7` (joined in the last 7 days), `online` (seen in the last 5 min),
  // `active1h` (seen in the last 60 min).
  login: z.enum(['all', 'dormant30', 'new7', 'online', 'active1h']).optional().default('all'),
});
  const SetSuspendSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});
const ReassignUplineSchema = z.object({
  newUplineId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id').optional(),
  newUplineUsername: z.string().trim().min(2).max(80).optional(),
}).refine((v) => !!v.newUplineId || !!v.newUplineUsername, { message: 'Provide newUplineId or newUplineUsername' });

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildAdminRouter = (deps = {}) => {
  const partners = deps.partners ?? new MongoPartnerRepository();
  const sessions = deps.sessions ?? {
    revoke: (id, opts) => revokeSessions(id, opts),
    clear: (id) => clearRevocations(id),
  };
  const controller = makeAdminController({
    setRole: new SetPartnerRoleUseCase({ partners }),
    listPartners: new ListPartnersUseCase({ partners }),
    setSuspend: new SetSuspendUseCase({ partners, sessions }),
    platformStats: new PlatformStatsUseCase({
      partners,
      progress: deps.progress ?? new MongoProgressionStore(),
    }),
    signOut: deps.signOut ?? (async ({ requesterId, partnerId }) => {
      await revokeSessions(partnerId, { reason: 'Admin force sign-out', by: requesterId });
      return { revoked: true };
    }),
    resetOnBehalf: deps.resetOnBehalf ?? new ResetOnBehalfUseCase({
      partners,
      reset: new RequestPasswordResetUseCase({
        partners,
        mailer: deps.mailer ?? new PasswordResetMailer(),
        frontendUrl: deps.frontendUrl ?? process.env.FRONTEND_URL ?? process.env.APP_BASE_URL ?? 'https://marketspase.com',
      }),
    }),
    erase: deps.erase ?? new ErasePartnerUseCase({
      partners,
      prospects: deps.prospects ?? new MongoProspectRepository(),
      tickets: deps.tickets ?? new MongoTicketRepository(),
      sessions,
    }),
    reassignUpline: deps.reassignUpline ?? new ReassignUplineUseCase({ partners }),
    member360: deps.member360 ?? new GetMember360UseCase({
      partners,
      transactions: deps.transactions ?? TransactionModel,
      deposits: deps.deposits ?? DepositIntentModel,
      prospects: deps.prospects ?? new MongoProspectRepository(),
      progress: deps.progress ?? new MongoProgressionStore(),
    }),
  });

  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));
  router.get('/partners', validate({ query: AdminListQuery }), controller.list);
  router.patch('/partners/:partnerId/role', validate({ params: PartnerIdParam, body: SetRoleSchema }), controller.setRole);
  router.patch('/partners/:partnerId/suspend', validate({ params: PartnerIdParam, body: SetSuspendSchema }), controller.suspend);
  router.patch('/partners/:partnerId/upline', validate({ params: PartnerIdParam, body: ReassignUplineSchema }), controller.reassignUpline);
  router.get('/stats', controller.stats);
  // Force sign-out: revokes live JWTs (sessions die on next call). Self allowed.
  router.post('/partners/:partnerId/signout', validate({ params: PartnerIdParam }), controller.signOut);
  // Member 360 — the admin's single read for "who is this member".
  router.get('/members/:partnerId/360', validate({ params: PartnerIdParam }), controller.member360);
  // Reset on behalf: the reset link goes to the MEMBER's email — admins never see passwords.
  router.post('/partners/:partnerId/reset-password', validate({ params: PartnerIdParam }), controller.resetOnBehalf);
  // GDPR erasure: anonymize + delete owned working data. Refuses with
  // downline (reassign first), self, last admin. Retained: ledger,
  // transactions, orders, posts (dispute/accounting history).
  router.delete('/partners/:partnerId', validate({ params: PartnerIdParam }), controller.erase);
  return router;
};

export default buildAdminRouter();
