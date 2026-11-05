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
    const mailer = fakeMailer();
    const events = fakeEvents();
    const uc = new SignupUseCase({
      partners,
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
    assert.equal(row.partnerOf, undefined);
    assert.equal(row.emailVerified, false);
    assert.equal(row.emailVerificationTokenHash, 'token-hash-1');
    assert.ok(row.emailVerificationExpires instanceof Date);

    assert.deepEqual(mailer.mails, [{
      to: 'ada@example.com',
      url: `https://marketspase.com/partner/verify-email?token=${'a'.repeat(64)}`,
    }]);
    assert.equal(events.emissions.length, 1);
    assert.equal(events.emissions[0].name, 'member.signedup');
    assert.equal(events.emissions[0].payload.partnerId, result.user.id);
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
