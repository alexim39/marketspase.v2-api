import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { UnauthorizedException } from '../../../shared/domain/AppError.js';

export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const refreshSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    scope: { type: String, enum: ['partner', 'admin'], required: true, index: true },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
    purgeAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
refreshSchema.index({ partnerId: 1, scope: 1, revokedAt: 1 });
refreshSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshSessionModel = mongoose.models.RefreshSession
  ?? mongoose.model('RefreshSession', refreshSchema);

const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

const newToken = () => crypto.randomBytes(48).toString('base64url');

/**
 * Rotating refresh sessions. The raw token is only ever in the httpOnly
 * cookie; the database stores a hash. Reusing a rotated token revokes the
 * whole family (stolen-token detection).
 */
export class RefreshSessions {
  async issue({ partnerId, scope = 'partner', ip = null, userAgent = null } = {}) {
    const token = newToken();
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await RefreshSessionModel.create({
      partnerId,
      tokenHash: hashToken(token),
      familyId,
      scope,
      ip: ip ? String(ip).slice(0, 64) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
      expiresAt,
      purgeAt: new Date(expiresAt.getTime() + PURGE_AFTER_MS),
    });
    return { token, expiresAt, familyId };
  }

  async rotate({ token, scope = 'partner', ip = null, userAgent = null } = {}) {
    if (!token) throw new UnauthorizedException('Refresh session missing');
    const tokenHash = hashToken(token);
    const current = await RefreshSessionModel.findOne({ tokenHash, scope }).lean();
    if (!current) throw new UnauthorizedException('Refresh session expired');

    if (current.revokedAt) {
      await this.revokeFamily(current.familyId);
      throw new UnauthorizedException('Refresh token was already used — sign in again');
    }
    if (new Date(current.expiresAt).getTime() <= Date.now()) {
      await this.revokeFamily(current.familyId);
      throw new UnauthorizedException('Refresh session expired — sign in again');
    }

    const nextToken = newToken();
    const nextHash = hashToken(nextToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const claimed = await RefreshSessionModel.findOneAndUpdate(
      { _id: current._id, revokedAt: null },
      { $set: { revokedAt: new Date(), replacedByHash: nextHash } },
      { new: true },
    ).lean();
    if (!claimed) {
      await this.revokeFamily(current.familyId);
      throw new UnauthorizedException('Refresh token was already used — sign in again');
    }

    await RefreshSessionModel.create({
      partnerId: current.partnerId,
      tokenHash: nextHash,
      familyId: current.familyId,
      scope,
      ip: ip ? String(ip).slice(0, 64) : current.ip,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : current.userAgent,
      expiresAt,
      purgeAt: new Date(expiresAt.getTime() + PURGE_AFTER_MS),
    });

    return {
      token: nextToken,
      expiresAt,
      partnerId: String(current.partnerId),
      scope,
    };
  }

  async revoke({ token, scope = 'partner' } = {}) {
    if (!token) return false;
    const result = await RefreshSessionModel.updateOne(
      { tokenHash: hashToken(token), scope, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    return (result.modifiedCount ?? 0) > 0;
  }

  async revokeFamily(familyId) {
    await RefreshSessionModel.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    ).catch(() => null);
  }

  async revokeAll(partnerId, scope = null) {
    await RefreshSessionModel.updateMany(
      { partnerId, ...(scope ? { scope } : {}), revokedAt: null },
      { $set: { revokedAt: new Date() } },
    ).catch(() => null);
  }
}

export const refreshCookieName = (scope) =>
  scope === 'admin' ? 'admin_refresh_jwt' : 'refresh_jwt';

export default RefreshSessions;
