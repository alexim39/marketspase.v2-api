import { AppError, ValidationException, UnauthorizedException, ForbiddenException } from '../../../shared/domain/AppError.js';
import { toSafePartner } from '../domain/Partner.entity.js';

/**
 * Signin — same observable behavior as legacy (generic "Wrong email or
 * password", 1-day JWT in cookie) but hashing/JWT live behind interfaces.
 */
export class SigninUseCase {
  /** @param {{partners, hasher, sessions, revocations?}} deps (`revocations.clear` runs on success) */
  constructor({ partners, hasher, sessions, revocations = null }) {
    Object.assign(this, { partners, hasher, sessions, revocations });
  }

  /**
   * @param {{email,password}} input (Zod-whitelisted)
   * @returns {{token, user}} user is secrets-stripped
   */
  async execute(input) {
    const email = String(input?.email ?? '').trim().toLowerCase();
    const password = String(input?.password ?? '');
    if (!email || !password) throw new ValidationException('Email and password are required');

    const user = await this.partners.findByEmail(email);
    if (!user) throw new UnauthorizedException('Wrong email or password');
    const ok = await this.hasher.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('Wrong email or password');
    if (user.suspendedAt) throw new ForbiddenException('Account suspended — contact support');
    // Legacy accounts predate verification; only an explicit false blocks.
    if (user.emailVerified === false) {
      throw new AppError(
        'Please verify your email address before signing in.',
        403,
        'EMAIL_NOT_VERIFIED',
      );
    }

    const id = String(user._id ?? user.id);
    // Fresh login lifts any prior revocation (force-sign-out / unsuspend path).
    if (this.revocations?.clear) await this.revocations.clear(id).catch(() => null);
    // Login telemetry (Member 360) — best-effort, never fails the signin.
    if (this.partners?.trackLogin) {
      await this.partners.trackLogin(id, {
        at: new Date(),
        ...(input.ip ? { ip: String(input.ip).slice(0, 64) } : {}),
        ...(input.agent ? { agent: String(input.agent).slice(0, 300) } : {}),
      }).catch(() => null);
    }
    return { token: this.sessions.sign(id), user: toSafePartner(user) };
  }
}
