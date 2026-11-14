import { AppError, ValidationException } from '../../../shared/domain/AppError.js';

/**
 * Step-up password confirmation for sensitive money actions.
 *
 * Withdrawal runs off the session cookie, so a left-open browser or a stolen
 * session could otherwise move the wallet balance. Requiring the account
 * password at the final confirmation step proves the person present knows the
 * credential. The comparison happens server-side; the password is never
 * stored or logged.
 */
export class ConfirmPasswordUseCase {
  constructor({ partners, hasher } = {}) {
    this.partners = partners;
    this.hasher = hasher;
  }

  async execute({ partnerId, password } = {}) {
    const plain = String(password ?? '');
    if (!plain.trim()) {
      throw new ValidationException('Enter your account password to confirm this withdrawal');
    }
    if (!this.partners?.findPasswordHash || !this.hasher?.compare) {
      throw new ValidationException('Password confirmation is unavailable right now');
    }

    const hash = await this.partners.findPasswordHash(partnerId).catch(() => null);
    if (!hash) {
      throw new ValidationException('Password confirmation is unavailable for this account. Contact support.');
    }

    const matches = await this.hasher.compare(plain, hash).catch(() => false);
    if (!matches) {
      throw new AppError(
        'Incorrect password. The withdrawal was not started.',
        422,
        'INVALID_PASSWORD',
        undefined,
        'Enter the password you use to sign in to MarketSpase, then try again.',
      );
    }

    return { confirmed: true };
  }
}

export default ConfirmPasswordUseCase;
