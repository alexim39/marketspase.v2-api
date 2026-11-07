import mongoose from 'mongoose';

/**
 * Server-side draft for important forms. One row per partner + key, TTL 30
 * days. Payload is a small JSON snapshot (never files or secrets); the web
 * client writes it while the session is alive and on expiry.
 */
const draftSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    key: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    path: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);
draftSchema.index({ partnerId: 1, key: 1 }, { unique: true });
draftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DraftModel = mongoose.models.Draft ?? mongoose.model('Draft', draftSchema);
