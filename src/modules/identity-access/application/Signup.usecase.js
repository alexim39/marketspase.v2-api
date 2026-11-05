import { ConflictException } from '../../../shared/domain/AppError.js';
import { createSignupEntity, baseUsernameFor, toSafePartner } from '../domain/Partner.entity.js';
import { domainEvents } from '../../../shared/events/DomainEvents.js';
import { ACTIVATION_EVENTS, signedUpPayload } from '../../activation/domain/ActivationEvents.js';

/**
 * Signup — transactional: uniqueness checks + partner creation happen inside
 * ONE Mongo session. Open signup requires no reservation code. New accounts
 * are unverified and receive a single-use email verification link after commit.
 */
export class SignupUseCase {
  constructor({
    partners,
    hasher,
    tx,
    events = null,
    tokens = null,
    verificationMailer = null,
    frontendUrl = 'https://marketspase.com',
  }) {
    this.partners = partners;
    this.hasher = hasher;
    this.tx = tx;
    this.events = events ?? domainEvents;
    this.tokens = tokens;
    this.verificationMailer = verificationMailer;
    this.frontendUrl = String(frontendUrl ?? 'https://marketspase.com').replace(/\/+$/, '');
  }

  async execute(input) {
    const entity = createSignupEntity(input);
    const issued = this.tokens?.issue?.() ?? null;

    let saved;
    let usernameRetries = 0;

    const createInTransaction = async (session) => {
      // Unique username: base, base1, base2... (legacy rule)
      const base = baseUsernameFor(entity.name, entity.surname);
      let username = base;
      for (let counter = 1; await this.partners.existsByUsername(username, { session }); counter++) {
        username = `${base}${counter}`;
      }

      const created = await this.partners.create(
        {
          name: entity.name,
          surname: entity.surname,
          email: entity.email,
          password: await this.hasher.hash(entity.password),
          tnc: entity.tnc,
          phone: entity.phone,
          username,
          accountState: 'member',
          kycStatus: 'not_started',
          ...(entity.campaignCode ? { campaignCode: entity.campaignCode } : {}),
          ...(issued ? {
            emailVerified: false,
            emailVerificationTokenHash: issued.hash,
            emailVerificationExpires: issued.expiresAt,
          } : {}),
        },
        { session },
      );

      return toSafePartner(created);
    };

    for (;;) {
      try {
        saved = await this.tx.runInTransaction(createInTransaction);
        break;
      } catch (error) {
        const usernameCollision = error?.code === 11000 && error?.keyPattern?.username;
        if (usernameCollision && usernameRetries < 2) {
          usernameRetries += 1;
          continue;
        }
        if (error?.code === 11000) {
          throw new ConflictException('An account with those details already exists');
        }
        throw error;
      }
    }

    let verificationSent = false;
    if (issued && this.verificationMailer) {
      try {
        const receipt = await this.verificationMailer.notifyVerification(
          entity.email,
          `${this.frontendUrl}/partner/verify-email?token=${encodeURIComponent(issued.token)}`,
          { name: entity.name },
        );
        verificationSent = receipt?.sent !== false;
        if (receipt && receipt.sent === false) {
          console.error('[auth] verification email failed:', receipt.error, `(${entity.email})`);
        }
      } catch (error) {
        console.error('[auth] verification email failed:', error?.message ?? error);
      }
    }

    if (saved?.id || saved?._id) {
      await this.events.emit(
        ACTIVATION_EVENTS.MEMBER_SIGNED_UP,
        signedUpPayload({
          partnerId: saved.id ?? saved._id,
          memberName: [entity.name, entity.surname].filter(Boolean).join(' '),
        }),
      ).catch(() => null);
    }

    return { user: saved, verificationSent };
  }
}
