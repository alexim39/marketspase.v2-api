/**
 * Contracts for the events slice. Visibility mirrors the community slice
 * (global / downline-team / ECL+ leadership); RSVPs are one-per-partner.
 */
export class EventStore {
  async createEvent(data) { throw new Error('Not implemented'); }
  async findEventById(id) { throw new Error('Not implemented'); }
  async upcomingCandidates(now, limit) { throw new Error('Not implemented'); }
  async listByAuthor(authorId, limit) { throw new Error('Not implemented'); }
  async deleteEvent(id) { throw new Error('Not implemented'); }
  async upsertRsvp(eventId, partnerId, status) { throw new Error('Not implemented'); }
  async upcomingRsvps(partnerId, now, horizonDays, limit) { throw new Error('Not implemented'); }
  async rsvpCounts(eventIds) { throw new Error('Not implemented'); }
  async myRsvps(eventIds, partnerId) { throw new Error('Not implemented'); }
  /** RSVPs (going/interested) since `since` — leadership footprint. */
  async countRsvpsSince(partnerId, since) { throw new Error('Not implemented'); }
  async authorLabels(ids) { throw new Error('Not implemented'); }
}
