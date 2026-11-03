import mongoose from 'mongoose';

/**
 * Infrastructure: Mongoose schema for tickets.
 * Points at the SAME `tickets` collection as legacy `Ticket` model
 * so the strangler reads/writes identical data.
 * Reuses the compiled model when legacy is also loaded to avoid
 * `OverwriteModelError` in a shared process.
 */
const ticketSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    date: { type: Date, required: true },
    category: { type: String, required: true, trim: true, maxlength: 120 },
    priority: { type: String, required: true, trim: true, maxlength: 40 },
    comment: { type: String, default: '', trim: true, maxlength: 5000 },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      required: true,
      index: true,
    },
    // Admin inbox workflow (added after launch) — absent on legacy rows,
    // which read back as `open` via mapper fallbacks. Never set by clients.
    status: {
      type: String,
      enum: ['open', 'in-progress', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    assigneeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
    },
    resolutionNote: { type: String, default: null, trim: true, maxlength: 2000 },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ticketSchema.index({ partnerId: 1, createdAt: -1 });
ticketSchema.index({ status: 1, createdAt: -1 });

export const TicketMongooseModel =
  // Distinct model name on the SAME 'tickets' collection: the legacy
  // `Ticket` model (status-less schema) loads first in server.js, so a
  // `?? mongoose.model('Ticket', ...)` reuse would silently keep the old
  // schema — strict mode then strips every status write and all rows read
  // back as 'open' forever. The explicit collection keeps one data home.
  mongoose.models.TicketV1 ?? mongoose.model('TicketV1', ticketSchema, 'tickets');
