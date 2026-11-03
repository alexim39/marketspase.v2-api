/**
 * Public entry for the events slice (group events + RSVP).
 * Visibility mirrors the community slice; RSVPs are one-per-partner.
 */
export { default, buildEventsRouter } from './interface/Events.routes.js';
export { RSVP_STATUSES } from './domain/Event.entity.js';
