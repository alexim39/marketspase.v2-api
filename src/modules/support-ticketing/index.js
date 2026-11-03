/**
 * Public entry for the support-ticketing slice.
 * Import the default router in `app.js` — never import internals directly.
 */
export { default, default as TicketV1Router, buildTicketRouter } from './interface/Ticket.routes.js';
export { SubmitTicketUseCase } from './application/SubmitTicket.usecase.js';
export { createTicketEntity } from './domain/Ticket.entity.js';
