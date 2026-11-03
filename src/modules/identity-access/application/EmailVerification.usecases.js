import { ValidationException } from '../../../shared/domain/AppError.js';

const TOKEN_RE = /^[a-f0-9]{64}$/i;

export class VerifyEmailUseCase {
  constructor({ partners, tokens }) {
    this.partners = partners;
    this.tokens = tokens;
  }

  async execute({ token }) {
    const raw = String(token ?? '').trim();
    if (!TOKEN_RE.test(raw)) {
      throw new ValidationException('This verification link is invalid or has expired');
    }
    const partner = await this.partners.consumeEmailVerificationToken(this.tokens.hash(raw), new Date());
    if (!partner) {
      throw new ValidationException('This verification link is invalid or has expired');
    }
    return { message: 'Email verified successfully' };
  }
}

export class ResendVerificationUseCase {
  constructor({ partners, tokens, mailer, frontendUrl }) {
    this.partners = partners;
    this.tokens = tokens;
    this.mailer = mailer;
    this.frontendUrl = String(frontendUrl ?? 'https://marketspase.com').replace(/\/+$/, '');
  }

  async execute({ email }) {
    const normalized = String(email ?? '').trim().toLowerCase();
    const partner = await this.partners.findByEmail(normalized);
    // Generic success for unknown/already-verified emails (anti-enumeration).
    if (!partner || partner.emailVerified !== false) return { sent: true };

    const issued = this.tokens.issue();
    await this.partners.updateById(String(partner._id ?? partner.id), {
      emailVerificationTokenHash: issued.hash,
      emailVerificationExpires: issued.expiresAt,
    });
    const url = `${this.frontendUrl}/partner/verify-email?token=${encodeURIComponent(issued.token)}`;
    try {
      const receipt = await this.mailer.notifyVerification(normalized, url, { name: partner.name });
      if (receipt && receipt.sent === false) {
        console.error('[auth] verification resend failed:', receipt.error, `(${normalized})`);
      }
    } catch (error) {
      console.error('[auth] verification resend failed:', error?.message ?? error);
    }
    return { sent: true };
  }
}
