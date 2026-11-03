import mongoose from 'mongoose';

/**
 * Session denylist — instant kill-switch for live JWTs.
 * `requireAuth` consults it after verifying the signature (one indexed
 * lookup); entries are written by suspend / force-sign-out and cleared
 * by signin / unsuspend. TTL (48h) outlives the 24h JWTs, so stale rows
 * self-clean even if a clear path is ever missed. Self-contained model
 * (no slice imports) so shared/http can depend on it cycle-free.
 */
const revokedSchema = new mongoose.Schema(
  {
    partnerId: { type: String, required: true, unique: true, index: true },
    revokedAt: { type: Date, default: Date.now, expires: 172800 },
    reason: { type: String, default: null },
    by: { type: String, default: null },
  },
  { timestamps: false },
);

export const RevokedSessionModel = mongoose.models['Revoked-session']
  ?? mongoose.model('Revoked-session', revokedSchema);

/** Injectable checker — tests swap the store without touching Mongo. */
let checker = async (partnerId) =>
  (await RevokedSessionModel.exists({ partnerId: String(partnerId) })) !== null;

export const setRevocationChecker = (fn) => {
  checker = fn;
};

export const isSessionRevoked = (partnerId) => checker(partnerId);

export const revokeSessions = async (partnerId, { reason = null, by = null } = {}) => {
  await RevokedSessionModel.findOneAndUpdate(
    { partnerId: String(partnerId) },
    { $set: { revokedAt: new Date(), reason, by } },
    { upsert: true },
  );
  return { revoked: true };
};

export const clearRevocations = async (partnerId) => {
  await RevokedSessionModel.deleteOne({ partnerId: String(partnerId) });
  return { cleared: true };
};
