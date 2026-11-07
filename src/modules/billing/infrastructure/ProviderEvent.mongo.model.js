import mongoose from 'mongoose';

/**
 * Processed provider webhook IDs. Paystack retries the same event; a unique
 * (provider, eventId) row lets the API short-circuit a replay while keeping
 * the underlying intent/status updates idempotent as a second line of defence.
 */
const providerEventSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, index: true },
    eventId: { type: String, required: true },
    event: { type: String, default: null },
    status: { type: String, enum: ['processed'], default: 'processed' },
    receivedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
  },
  { timestamps: false },
);
providerEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export const ProviderEventModel = mongoose.models.ProviderEvent
  ?? mongoose.model('ProviderEvent', providerEventSchema);

export const markProviderEventProcessed = async ({ provider, eventId, event = null }) => {
  if (!eventId || mongoose.connection?.readyState !== 1) return { stored: false };
  try {
    await ProviderEventModel.updateOne(
      { provider, eventId },
      { $setOnInsert: { provider, eventId, event, receivedAt: new Date() } },
      { upsert: true },
    );
    return { stored: true };
  } catch (error) {
    if (error?.code === 11000) return { stored: true, duplicate: true };
    throw error;
  }
};

export const wasProviderEventProcessed = async ({ provider, eventId }) => {
  if (!eventId || mongoose.connection?.readyState !== 1) return false;
  return (await ProviderEventModel.exists({ provider, eventId })) !== null;
};
