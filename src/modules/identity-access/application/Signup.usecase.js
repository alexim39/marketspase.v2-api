import { AppError, ConflictException, ValidationException } from '../../../shared/domain/AppError.js';
import { createSignupEntity, baseUsernameFor, toSafePartner } from '../domain/Partner.entity.js';
import { domainEvents } from '../../../shared/events/DomainEvents.js';
import { RESERVATION_EVENTS, consumedPayload } from '../../reservations/domain/ReservationEvents.js';

/**
 * Signup — transactional: uniqueness checks + partner creation happen inside
 * ONE Mongo session. Open signup no longer requires a reservation code; legacy
 * codes remain optional during the transition. New accounts are unverified and
 * receive a single-use email verification link after commit.
 */
export class SignupUseCase {
  constructor({
    partners,
    reservations,
    hasher,
    tx,
    events = null,
    tokens = null,
    verificationMailer = null,
    frontendUrl = 'https://marketspase.com',
  }) {
    this.partners = partners;
    this.reservations = reservations;
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
    let activation = null;

    let saved;
    let usernameRetries = 0;

    const createInTransaction = async (session) => {
      let partnerOf = null;
      let reservation = null;

      if (entity.reservationCode) {
        if (!this.reservations) {
          throw new ValidationException('Reservation codes are not available');
        }
        reservation = await this.reservations.findByCode(entity.reservationCode, { session });
        if (!reservation) {
          throw new ValidationException('The reservation code is invalid or does not exist');
        }
        if (reservation.status === 'Pending') {
          throw new AppError('Reservation code is pending approval', 402, 'RESERVATION_PENDING');
        }
        if (await this.partners.existsByReservationCode(entity.reservationCode, { session })) {
          throw new AppError('This reservation code has already been used', 401, 'CODE_ALREADY_USED');
        }
        if (reservation.status === 'Approved' && reservation.partnerId) {
          const upline = await this.partners.findById(reservation.partnerId, { session });
          if (!upline) throw new AppError('Upline partner not found', 404, 'NOT_FOUND');
          partnerOf = reservation.partnerId;
        }
      }

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
            ...(entity.reservationCode ? { reservationCode: entity.reservationCode } : {}),
          ...(partnerOf ? { partnerOf } : {}),
          ...(issued ? {
            emailVerified: false,
            emailVerificationTokenHash: issued.hash,
            emailVerificationExpires: issued.expiresAt,
          } : {}),
        },
        { session },
      );

      if (entity.reservationCode) {
        await this.reservations.markUsed(entity.reservationCode, { session });
      }

      // Welcome/lifecycle fan-out runs for every signup; code-specific
      // legs are skipped by the subscriber when code/upline/prospect are null.
      activation = {
        code: entity.reservationCode ?? '',
        uplineId: partnerOf,
        prospectId: reservation?.prospectId ?? null,
        memberName: [entity.name, entity.surname].filter(Boolean).join(' '),
      };
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

    if (activation) {
      await this.events.emit(
        RESERVATION_EVENTS.CONSUMED,
        consumedPayload({ ...activation, partnerId: saved.id ?? saved._id }),
      ).catch(() => null);
    }

    return { user: saved, verificationSent };
  }
}
