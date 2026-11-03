import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { VerifyEmailUseCase, ResendVerificationUseCase } = await import('./EmailVerification.usecases.js');
const { SigninUseCase } = await import('./Signin.usecase.js');

const tokens = {
  issue: () => ({
    token: 'b'.repeat(64),
    hash: 'hash-b',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }),
  hash: (token) => `hashed:${token}`,
};

describe('VerifyEmailUseCase', () => {
  it('consumes a valid token and verifies the account', async () => {
    let consumed = null;
    const partners = {
      consumeEmailVerificationToken: async (hash, now) => {
        consumed = { hash, now };
        return { _id: 'p1', email: 'ada@example.com', emailVerified: true };
      },
    };
    const uc = new VerifyEmailUseCase({ partners, tokens });
    const result = await uc.execute({ token: 'c'.repeat(64) });
    assert.equal(result.message, 'Email verified successfully');
    assert.equal(consumed.hash, `hashed:${'c'.repeat(64)}`);
    assert.ok(consumed.now instanceof Date);
  });

  it('rejects malformed tokens before touching the database', async () => {
    let touched = false;
    const uc = new VerifyEmailUseCase({
      partners: { consumeEmailVerificationToken: async () => { touched = true; return null; } },
      tokens,
    });
    await assert.rejects(uc.execute({ token: 'short' }), /invalid or has expired/);
    assert.equal(touched, false);
  });

  it('rejects expired/unknown tokens', async () => {
    const uc = new VerifyEmailUseCase({
      partners: { consumeEmailVerificationToken: async () => null },
      tokens,
    });
    await assert.rejects(uc.execute({ token: 'd'.repeat(64) }), /invalid or has expired/);
  });
});

describe('ResendVerificationUseCase', () => {
  const makePartners = (user) => {
    const patches = [];
    return {
      patches,
      findByEmail: async () => user,
      updateById: async (id, patch) => {
        patches.push({ id, patch });
        return { ...user, ...patch };
      },
    };
  };

  it('returns generic success without mailing unknown emails', async () => {
    let mailed = 0;
    const uc = new ResendVerificationUseCase({
      partners: makePartners(null),
      tokens,
      mailer: { notifyVerification: async () => { mailed += 1; return { sent: true }; } },
      frontendUrl: 'https://marketspase.com',
    });
    assert.deepEqual(await uc.execute({ email: 'ghost@example.com' }), { sent: true });
    assert.equal(mailed, 0);
  });

  it('returns generic success without mailing verified or legacy accounts', async () => {
    let mailed = 0;
    for (const user of [
      { _id: 'p1', email: 'a@example.com', emailVerified: true },
      { _id: 'p2', email: 'b@example.com' },
    ]) {
      const uc = new ResendVerificationUseCase({
        partners: makePartners(user),
        tokens,
        mailer: { notifyVerification: async () => { mailed += 1; return { sent: true }; } },
        frontendUrl: 'https://marketspase.com',
      });
      assert.deepEqual(await uc.execute({ email: user.email }), { sent: true });
    }
    assert.equal(mailed, 0);
  });

  it('reissues a token and sends a verification link for unverified accounts', async () => {
    const partners = makePartners({ _id: 'p1', email: 'ada@example.com', emailVerified: false });
    let mail = null;
    const uc = new ResendVerificationUseCase({
      partners,
      tokens,
      mailer: {
        notifyVerification: async (to, url) => {
          mail = { to, url };
          return { sent: true };
        },
      },
      frontendUrl: 'https://marketspase.com/',
    });

    assert.deepEqual(await uc.execute({ email: 'ADA@example.com' }), { sent: true });
    assert.equal(partners.patches.length, 1);
    assert.equal(partners.patches[0].patch.emailVerificationTokenHash, 'hash-b');
    assert.ok(partners.patches[0].patch.emailVerificationExpires instanceof Date);
    assert.deepEqual(mail, {
      to: 'ada@example.com',
      url: `https://marketspase.com/partner/verify-email?token=${'b'.repeat(64)}`,
    });
  });

  it('stays generic even when the mail provider fails', async () => {
    const uc = new ResendVerificationUseCase({
      partners: makePartners({ _id: 'p1', email: 'ada@example.com', emailVerified: false }),
      tokens,
      mailer: { notifyVerification: async () => ({ sent: false, error: 'smtp down' }) },
      frontendUrl: 'https://marketspase.com',
    });
    assert.deepEqual(await uc.execute({ email: 'ada@example.com' }), { sent: true });
  });
});

describe('SigninUseCase email verification gate', () => {
  const build = (user) => new SigninUseCase({
    partners: {
      findByEmail: async () => user,
      trackLogin: async () => null,
    },
    hasher: { compare: async () => true },
    sessions: { sign: () => 'jwt-token' },
    revocations: { clear: async () => {} },
  });

  it('blocks unverified accounts with EMAIL_NOT_VERIFIED', async () => {
    await assert.rejects(
      build({ _id: 'p1', email: 'a@example.com', password: 'hash', emailVerified: false }).execute({
        email: 'a@example.com',
        password: 'secret',
      }),
      (error) => error.statusCode === 403 && error.code === 'EMAIL_NOT_VERIFIED',
    );
  });

  it('allows legacy accounts with no emailVerified field', async () => {
    const result = await build({ _id: 'p2', email: 'b@example.com', password: 'hash' }).execute({
      email: 'b@example.com',
      password: 'secret',
    });
    assert.equal(result.token, 'jwt-token');
  });
});
