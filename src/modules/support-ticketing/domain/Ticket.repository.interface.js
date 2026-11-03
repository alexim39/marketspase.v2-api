/**
 * Repository interface for the Ticket bounded context.
 * Infrastructure (`Ticket.mongo.repository.js`) implements this.
 * Application layer depends ONLY on this contract.
 *
 * @typedef {import('./Ticket.entity.js').TicketProps & {id?:string}} PersistedTicket
 */

/**
 * @interface
 */
export class TicketRepository {
  /** @param {import('./Ticket.entity.js').TicketProps} entity @returns {Promise<PersistedTicket>} */
  async save(entity) {
    throw new Error('Not implemented');
  }
}
