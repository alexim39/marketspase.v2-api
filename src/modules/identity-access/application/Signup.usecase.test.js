import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWTTOKENSECRET ??= 'test-secret-for-signup-suite';

const { SignupUseCase } = await import('./Signup.usecase.js');

const fakePartners = (seed = [], { createError = null } = {}) => {
  const rows = new Map(seed.map((row) => [String(row.email), row]));
  const all = () => [...rows.values()];
  return {
    rows,
    findByEmail: async (email) => rows.get(String(email).toLowerCase()) ?? null,
    findById: async (id) => all().find((row) => String(row._id ?? row.id) === String(id)) ?? null,
    existsByUsername: async (username) => all().some((row) => row.username === username),
    existsByReservationCode: async (code) => all().some((row) => row.reservationCode === code),
    create: async (data) => {
      if (createError) throw createError;
      const row = { _id: `id-${rows.size + 1}`, ...data };
      rows.set(String(row.email), row);
      return row;
    },
    updateById: async (id, patch) => {
      const row = all().find((entry) => String(entry._id ?? entry.id) === String(id));
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
    consumeEmailVerificationToken: async () => null,
  };
};

const fakeHasher = { hash: async (plain) => `hashed:${plain}` };
const fakeTx = { runInTransaction: async (fn) => fn(undefined) };

const tokenService = {
  issue: () => ({
    token: 'a'.repeat(64),
    hash: 'token-hash-1',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }),
  hash: (token) => `hashed-token:${token}`,
};

const fakeMailer = (receipt = { sent: true }) => {
  const mails = [];
  return {
    mails,
    notifyVerification: async (to, url) => {
      mails.push({ to, url });
      return receipt;
    },
  };
};

const fakeEvents = () => {
  const emissions = [];
  return {
    emissions,
    emit: async (name, payload) => {
      emissions.push({ name, payload });
    },
  };
};

const fakeReservations = (codes = {}) => {
  const used = [];
  return {
    used,
    findByCode: async (code) => codes[code] ?? null,
    markUsed: async (code) => {
      used.push(code);
      return { used: true };
    },
  };
};

const baseInput = {
  name: 'Ada',
  surname: 'Lovelace',
  email: 'ada@example.com',
  phone: '08012345678',
  password: 'secret123',
  tnc: true,
};

describe('SignupUseCase', () => {
  it('creates an unverified open account with no upline and emails a verification link', async () => {
    const partners = fakePartners();
    const reservations = fakeReservations();
    const mailer = fakeMailer();
    const events = fakeEvents();
    const uc = new SignupUseCase({
      partners,
      reservations,
      hasher: fakeHasher,
      tx: fakeTx,
      events,
      tokens: tokenService,
      verificationMailer: mailer,
      frontendUrl: 'https://marketspase.com/',
    });

    const result = await uc.execute(baseInput);

    assert.equal(result.verificationSent, true);
    assert.equal(result.user.emailVerified, false);
    assert.equal(result.user.partnerOf, undefined);

    const row = partners.rows.get('ada@example.com');
    assert.equal(row.reservationCode, undefined);
    assert.equal(row.partnerOf, undefined);
    assert.equal(row.emailVerified, false);
    assert.equal(row.emailVerificationTokenHash, 'token-hash-1');
    assert.ok(row.emailVerificationExpires instanceof Date);

    assert.deepEqual(mailer.mails, [{
      to: 'ada@example.com',
      url: `https://marketspase.com/partner/verify-email?token=${'a'.repeat(64)}`,
    }]);
    assert.equal(events.emissions.length, 1);
    assert.equal(events.emissions[0].payload.uplineId, null);
    assert.equal(events.emissions[0].payload.code, '');
  });

  it('keeps legacy reservation-code signup working, links the upline and consumes the code', async () => {
    const partners = fakePartners([
      { _id: 'upline-1', email: 'upline@example.com', username: 'upline' },
    ]);
    const reservations = fakeReservations({
      ABC123: { id: 'res-1', status: 'Approved', partnerId: 'upline-1', prospectId: 'prospect-1' },
    });
    const events = fakeEvents();
    const uc = new SignupUseCase({
      partners,
      reservations,
      hasher: fakeHasher,
      tx: fakeTx,
      events,
      tokens: tokenService,
      verificationMailer: fakeMailer(),
      frontendUrl: 'https://marketspase.com',
    });

    const result = await uc.execute({ ...baseInput, reservationCode: 'ABC123' });

    const row = partners.rows.get('ada@example.com');
    assert.equal(row.reservationCode, 'ABC123');
    assert.equal(row.partnerOf, 'upline-1');
    assert.deepEqual(reservations.used, ['ABC123']);
    assert.equal(events.emissions[0].payload.uplineId, 'upline-1');
    assert.equal(events.emissions[0].payload.prospectId, 'prospect-1');
    assert.equal(result.user.emailVerified, false);
  });

  it('rejects a missing legacy reservation code', async () => {
    const uc = new SignupUseCase({
      partners: fakePartners(),
      reservations: fakeReservations(),
      hasher: fakeHasher,
      tx: fakeTx,
      tokens: tokenService,
      verificationMailer: fakeMailer(),
    });
    await assert.rejects(
      uc.execute({ ...baseInput, reservationCode: 'NOPE' }),
      /invalid or does not exist/,
    );
  });

  it('rejects a pending reservation code', async () => {
    const uc = new SignupUseCase({
      partners: fakePartners(),
      reservations: fakeReservations({
        PENDING1: { id: 'res-1', status: 'Pending', partnerId: null, prospectId: null },
      }),
      hasher: fakeHasher,
      tx: fakeTx,
      tokens: tokenService,
      verificationMailer: fakeMailer(),
    });
    await assert.rejects(
      uc.execute({ ...baseInput, reservationCode: 'PENDING1' }),
      (error) => error.code === 'RESERVATION_PENDING',
    );
  });

  it('rejects a reservation code already attached to a partner', async () => {
    const uc = new SignupUseCase({
      partners: fakePartners([
        { _id: 'used-1', email: 'used@example.com', username: 'used', reservationCode: 'USED1' },
      ]),
      reservations: fakeReservations({
        USED1: { id: 'res-1', status: 'Approved', partnerId: 'upline-1', prospectId: null },
      }),
      hasher: fakeHasher,
      tx: fakeTx,
      tokens: tokenService,
      verificationMailer: fakeMailer(),
    });
    await assert.rejects(
      uc.execute({ ...baseInput, reservationCode: 'USED1' }),
      (error) => error.code === 'CODE_ALREADY_USED',
    );
  });

  it('retries a username race before giving up', async () => {
    const partners = fakePartners();
    const originalCreate = partners.create;
    let calls = 0;
    partners.create = async (data) => {
      calls += 1;
      if (calls === 1) throw { code: 11000, keyPattern: { username: 1 } };
      return originalCreate(data);
    };
    const uc = new SignupUseCase({
      partners,
      reservations: fakeReservations(),
      hasher: fakeHasher,
      tx: fakeTx,
      tokens: tokenService,
      verificationMailer: fakeMailer(),
    });
    const result = await uc.execute(baseInput);
    assert.equal(calls, 2);
    assert.equal(result.user.email, 'ada@example.com');
  });

  it('maps duplicate database keys to a conflict', async () => {
    const uc = new SignupUseCase({
      partners: fakePartners([], { createError: { code: 11000 } }),
      reservations: fakeReservations(),
      hasher: fakeHasher,
      tx: fakeTx,
      tokens: tokenService,
      verificationMailer: fakeMailer(),
    });
    await assert.rejects(
      uc.execute(baseInput),
      (error) => error.statusCode === 409 && /already exists/.test(error.message),
    );
  });

  it('still creates the account when the verification email cannot be sent', async () => {
    const partners = fakePartners();
    const uc = new SignupUseCase({
      partners,
      reservations: fakeReservations(),
      hasher: fakeHasher,
      tx: fakeTx,
      tokens: tokenService,
      verificationMailer: fakeMailer({ sent: false, error: 'smtp down' }),
    });
    const result = await uc.execute(baseInput);
    assert.equal(result.verificationSent, false);
    assert.ok(partners.rows.get('ada@example.com'));
  });
});
