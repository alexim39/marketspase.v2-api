import mongoose from 'mongoose';
// Strangler note: reuse the legacy compiled models so both stacks share
// ONE collection + ONE schema. The schema text moves into this folder
// (like Ticket.schema.js) at final cutover; duplicating the 168-line
// Partner schema now would risk drift between the two stacks.
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { ReservationCodeModel } from '../../../apps/reservation-code/models/reservation-code.model.js';

export { PartnersModel, ReservationCodeModel };

/**
 * Runs `fn(session)` inside a Mongo transaction (snapshot of `tx`).
 * Falls back to a session-less call when no connection supports it,
 * so unit tests with fakes never need Mongo.
 */
export const runInTransaction = async (fn) => {
  if (mongoose.connection?.readyState !== 1) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};
