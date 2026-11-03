import mongoose from 'mongoose';

/**
 * Broadcast record — one row per platform-wide notice. The per-member
 * inbox rows live in stored-notifications (keyed `broadcast:<id>` for
 * dedupe); this row is the history/audit source. v2 campaigns add
 * channels/audience/schedule/stats (v1 in-app rows simply leave them
 * at defaults).
 */
const broadcastSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, required: true, maxlength: 2000 },
    link: { type: String, default: null, maxlength: 500 },
    priority: { type: String, enum: ['high', 'medium'], default: 'high' },
    createdBy: { type: String, required: true, index: true },
    recipientCount: { type: Number, default: 0 },
    capped: { type: Boolean, default: false },
    // v2 campaign fields
    subject: { type: String, default: null, maxlength: 120 },
    smsBody: { type: String, default: null, maxlength: 459 },
    channels: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
    },
    kind: { type: String, enum: ['system', 'marketing'], default: 'system', index: true },
    audience: { type: mongoose.Schema.Types.Mixed, default: null },
    sendAt: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ['sending', 'sent', 'scheduled', 'failed', 'cancelled'],
      default: 'sending',
      index: true,
    },
    stats: { type: mongoose.Schema.Types.Mixed, default: null },
    estimatedSmsSpend: { type: Number, default: null },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
broadcastSchema.index({ createdAt: -1 });

export const BroadcastModel = mongoose.models.Broadcast
  ?? mongoose.model('Broadcast', broadcastSchema);
