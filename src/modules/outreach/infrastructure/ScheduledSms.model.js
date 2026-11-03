import mongoose from 'mongoose';

/* Scheduled outreach — fire-and-forget outbox read by the minute worker. */
const scheduledSmsSchema = mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ['sms', 'email'],
      default: 'sms',
      index: true,
    },
    to: {
      type: [String],
      required: [true, 'Recipients are required'],
    },
    smsBody: {
      type: String,
      required: [true, 'Message is required'],
    },
    emailSubject: {
      type: String,
      default: '',
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null,
    },
    sendAt: {
      type: Date,
      required: [true, 'Scheduled time is required'],
      index: true,
    },
    status: {
      type: String,
      enum: ['scheduled', 'sending', 'sent', 'failed', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

scheduledSmsSchema.index({ status: 1, sendAt: 1 });

/* Model */
export const ScheduledSmsModel = mongoose.models['Scheduled-sms']
  ?? mongoose.model('Scheduled-sms', scheduledSmsSchema);
