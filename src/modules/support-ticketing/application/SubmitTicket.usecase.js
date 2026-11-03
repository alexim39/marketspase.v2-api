import { createTicketEntity } from '../domain/Ticket.entity.js';

/**
 * Application Service / Use Case — orchestrates, never touches DB/HTTP.
 * Steps: build domain entity -> persist via abstract repo -> notify owner.
 * Email failure must NOT fail the ticket (legacy 500'd; we log + continue).
 */
export class SubmitTicketUseCase {
  /**
   * @param {{ticketRepo: import('../domain/Ticket.repository.interface.js').TicketRepository, mailer: {notifyOwner:(t:any)=>Promise<void>}}} deps
   */
  constructor({ ticketRepo, mailer }) {
    this.ticketRepo = ticketRepo;
    this.mailer = mailer;
  }

  /**
   * @param {object} input whitelisted by Zod validator
   * @returns {Promise<any>} persisted ticket as domain object
   */
  async execute(input) {
    const entity = createTicketEntity(input);
    const saved = await this.ticketRepo.save(entity);
    try {
      await this.mailer.notifyOwner(saved);
    } catch (err) {
      console.error('[ticket] owner notify failed:', err?.message || err);
    }
    return saved;
  }
}
