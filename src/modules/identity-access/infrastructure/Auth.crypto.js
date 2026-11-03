import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { UnauthorizedException } from '../../../shared/domain/AppError.js';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Infrastructure: opaque, single-use email verification tokens. */
export class EmailVerificationTokens {
  issue() {
    const token = crypto.randomBytes(32).toString('hex');
    return {
      token,
      hash: this.hash(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    };
  }

  hash(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }
}

/** Infrastructure: bcrypt (cost 10, same as legacy). */
export class BcryptPasswordHasher {
  async hash(plain) {
    return bcrypt.hash(String(plain), 10);
  }
  async compare(plain, hash) {
    return bcrypt.compare(String(plain), String(hash));
  }
}

/** Infrastructure: JWT session tokens — same `{ id }`, 1d shape as legacy. */
export class JwtSessionIssuer {
  sign(partnerId) {
    return jwt.sign({ id: String(partnerId) }, process.env.JWTTOKENSECRET, { expiresIn: '1d' });
  }
  verify(token) {
    try {
      const claims = jwt.verify(token, process.env.JWTTOKENSECRET);
      if (!claims?.id) throw new UnauthorizedException('User unauthenticated');
      return String(claims.id);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
