import jwt from 'jsonwebtoken';
import { ValidationException, UnauthorizedException, ServiceUnavailableException } from '../../../shared/domain/AppError.js';
import { PlainPassword, toSafePartner } from '../domain/Partner.entity.js';

const RESET_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Password reset, implemented correctly: legacy `requestPasswordReset`
 * crashes (`nodemailer` never imported, `auth.controller.js:215`) and
 * `resetPassword` references an undefined `SECRET_KEY` and has no route.
 * New flow persists token+expiry on the partner (schema fields already
 * exist) and never reveals whether an email is registered (anti-enumeration).
 */
export class RequestPasswordResetUseCase {
  /** @param {{partners, mailer, frontendUrl}} deps */
  constructor({ partners, mailer, frontendUrl }) {
    this.partners = partners;
    this.mailer = mailer;
    this.frontendUrl = frontendUrl;
  }

  async execute({ email }) {
    const normalized = String(email ?? '').trim().toLowerCase();
    const partner = await this.partners.findByEmail(normalized);
    // Always succeed publicly — prevents email enumeration (legacy returned 404).
    if (!partner) return { sent: false };

    const token = jwt.sign({ email: normalized }, process.env.JWTTOKENSECRET, { expiresIn: '1h' });
    await this.partners.updateById(String(partner._id ?? partner.id), {
      resetPasswordToken: token,
      resetPasswordExpires: new Date(Date.now() + RESET_TTL_MS).toISOString(),
    });
    try {
      const receipt = await this.mailer.notifyPasswordReset(
        normalized,
        `${this.frontendUrl}/partner/reset-password?token=${token}`,
      );
      // Fake mailers resolve undefined — only an explicit `sent: false`
      // means the mail run failed (e.g. SMTP unconfigured/down).
      if (receipt && receipt.sent === false) {
        console.error('[auth] reset email failed:', receipt.error, `(${normalized})`);
        throw new ServiceUnavailableException(
          'We could not send the reset email — please try again in a few minutes.',
        );
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      console.error('[auth] reset email failed:', err?.message || err);
      throw new ServiceUnavailableException(
        'We could not send the reset email — please try again in a few minutes.',
      );
    }
    return { sent: true };
  }
}

export class ResetPasswordUseCase {
  /** @param {{partners, hasher}} deps */
  constructor({ partners, hasher }) {
    this.partners = partners;
    this.hasher = hasher;
  }

  async execute({ token, newPassword }) {
    if (!token || !newPassword) {
      throw new ValidationException('Token and new password are required');
    }
    let claims;
    try {
      claims = jwt.verify(token, process.env.JWTTOKENSECRET);
    } catch {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    const partner = await this.partners.findByEmail(String(claims.email).toLowerCase());
    const stored = partner?.resetPasswordToken;
    const expires = partner?.resetPasswordExpires ? new Date(partner.resetPasswordExpires).getTime() : 0;
    if (!partner || stored !== token || Date.now() > expires) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    PlainPassword.create(newPassword); // strength rule shared with signup
    await this.partners.updateById(String(partner._id ?? partner.id), {
      password: await this.hasher.hash(String(newPassword)),
      resetPasswordToken: undefined,
      resetPasswordExpires: undefined,
    });
    return { message: 'Password successfully updated' };
  }
}
