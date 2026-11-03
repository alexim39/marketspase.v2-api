/**
 * Repository contracts for identity-access.
 * Application layer depends ONLY on these — never on Mongoose.
 * All methods accept an optional `{ session }` so use-cases can run
 * multi-write flows (signup + reservation link) inside one transaction.
 */

/** @typedef {{session?: any}} TxOpts */

export class PartnerRepository {
  /** @param {string} email @param {TxOpts} [_opts] */
  async findByEmail(email, _opts) { throw new Error('Not implemented'); }
  /** @param {string} id @param {TxOpts} [_opts] */
  async findById(id, _opts) { throw new Error('Not implemented'); }
  /** @param {string} username @param {TxOpts} [_opts] @returns {Promise<boolean>} */
  async existsByUsername(username, _opts) { throw new Error('Not implemented'); }
  /** @param {string} code @param {TxOpts} [_opts] @returns {Promise<boolean>} */
  async existsByReservationCode(code, _opts) { throw new Error('Not implemented'); }
  /** @param {object} data @param {TxOpts} [_opts] @returns {Promise<any>} */
  async create(data, _opts) { throw new Error('Not implemented'); }
  /** @param {string} id @param {object} patch @param {TxOpts} [_opts] @returns {Promise<any>} */
  async updateById(id, patch, _opts) { throw new Error('Not implemented'); }
  /** Atomically consume a hashed, unexpired verification token. */
  async consumeEmailVerificationToken(hash, now) { throw new Error('Not implemented'); }

  async reassignDownline(partnerId, newUplineId) { throw new Error('Not implemented'); }
  /** Signup cohort for activation analytics: [{id, createdAt, phone, address}] (bounded). */
  async activationCohort(ids, since) { throw new Error('Not implemented'); }
}

export class ReservationRepository {
  /**
   * Case-insensitive code lookup (matches legacy collation behavior).
   * @param {string} code @param {TxOpts} [_opts]
   * @returns {Promise<{id:string,status:string,partnerId:string|null,prospectId:string|null}|null>}
   */
  async findByCode(code, _opts) { throw new Error('Not implemented'); }
  /** Stamp a consumed code Used (same tx as partner creation). */
  async markUsed(code, _opts) { throw new Error('Not implemented'); }
}

export class PasswordHasher {
  /** @param {string} plain @returns {Promise<string>} */
  async hash(plain) { throw new Error('Not implemented'); }
  /** @param {string} plain @param {string} hash @returns {Promise<boolean>} */
  async compare(plain, hash) { throw new Error('Not implemented'); }
}

export class SessionIssuer {
  /** @param {string} partnerId @returns {string} signed JWT */
  sign(partnerId) { throw new Error('Not implemented'); }
  /** @param {string} token @returns {string} partnerId @throws {UnauthorizedException} */
  verify(token) { throw new Error('Not implemented'); }
}
