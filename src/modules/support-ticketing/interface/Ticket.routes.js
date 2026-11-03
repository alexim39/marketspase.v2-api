import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { optionalAuth, requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { SubmitTicketSchema } from './Ticket.validator.js';
import { makeSubmitTicketController } from './Ticket.controller.js';
import { SubmitTicketUseCase } from '../application/SubmitTicket.usecase.js';
import { ListTicketsUseCase, DecideTicketUseCase, TICKET_STATUSES } from '../application/Ticket.inbox.usecase.js';
import { MongoTicketRepository } from '../infrastructure/Ticket.mongo.repository.js';
import { TicketMailer } from '../infrastructure/clients/TicketMailer.js';
import { NotifyUseCase } from '../../notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';
import { recordAudit } from '../../audit/index.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const InboxQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  q: z.string().trim().max(120).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  skip: z.coerce.number().int().min(0).optional().default(0),
});

const DecideSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  assigneeId: objectId.optional(),
  note: z.string().trim().max(2000).optional(),
  reopen: z.boolean().optional().default(false),
});

/**
 * Manual wiring (no DI container on purpose — explicit for onboarding).
 * Exported factory allows tests to inject fakes.
 */
export const buildTicketRouter = ({ ticketRepo, mailer, inbox: inboxDep, decide: decideDep } = {}) => {
  const repo = ticketRepo ?? new MongoTicketRepository();
  const mail = mailer ?? new TicketMailer();
  const submitTicket = new SubmitTicketUseCase({ ticketRepo: repo, mailer: mail });
  const handler = makeSubmitTicketController(submitTicket);
  const inbox = inboxDep ?? new ListTicketsUseCase({ tickets: repo, partners: new MongoPartnerRepository() });
  const decide = decideDep ?? new DecideTicketUseCase({ tickets: repo });
  const notifyStore = new MongoStoredNotificationStore();
  const notify = new NotifyUseCase({ stored: notifyStore });

  const router = express.Router();
  // Canonical REST path when mounted at /v1/tickets
  router.post('/', optionalAuth, validate({ body: SubmitTicketSchema }), handler);
  // Legacy alias — lets frontend switch base URL without changing path
  router.post('/submit', optionalAuth, validate({ body: SubmitTicketSchema }), handler);

  // NOTE: static `/inbox` must precede `/:ticketId` or Express swallows it.
  router.get('/inbox', requireAuth, requireRole('admin'), validate({ query: InboxQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await inbox.execute({ status: q?.status ?? null, q: q?.q ?? '', limit: q?.limit, skip: q?.skip });
    res.status(200).json({ message: 'Ticket inbox retrieved successfully', data, success: true });
  }));

  router.patch('/:ticketId', requireAuth, requireRole('admin'), validate({ params: z.object({ ticketId: objectId }), body: DecideSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const { previous, ticket } = await decide.execute({
      ticketId: params.ticketId,
      status: body.status ?? null,
      assigneeId: body.assigneeId ?? null,
      note: body.note ?? null,
      reopen: body.reopen ?? false,
    });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'ticket.decide',
      targetType: 'ticket', targetId: params.ticketId,
      detail: { from: previous?.status ?? 'open', to: ticket?.status ?? null, assignee: body.assigneeId ?? null },
    });
    // Tell the requester on resolve (best-effort — never fails the decision).
    if ((ticket?.status === 'resolved' || ticket?.status === 'closed') && ticket?.partnerId) {
      const key = `ticket:${params.ticketId}:${ticket.status}`;
      notify.execute({
        recipientId: String(ticket.partnerId),
        category: 'system',
        priority: 'medium',
        title: `Your support ticket was ${ticket.status}`,
        body: ticket.resolutionNote
          ? `"${ticket.subject}" — ${ticket.resolutionNote}`
          : `Your ticket "${ticket.subject}" was marked ${ticket.status}.`,
        icon: 'support_agent',
        link: '/dashboard/support/ticket',
        key,
      }).catch(() => null);
    }
    res.status(200).json({ message: 'Ticket updated successfully', data: ticket, success: true });
  }));
  return router;
};

export default buildTicketRouter();
