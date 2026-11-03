/**
 * Public entry for the reservations slice (referral-code lifecycle).
 * One status machine (Pending → Approved → Used) shared by the my-partners
 * record flow, prospect conversion and signup consume. Same collection
 * as legacy — validated boundary, no behavior change for old rows.
 */
export { default, buildReservationsRouter } from './interface/Reservations.routes.js';
export { RESERVATION_STATUSES } from './domain/Reservation.entity.js';
