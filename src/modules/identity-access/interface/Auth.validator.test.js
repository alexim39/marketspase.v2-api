import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SignupSchema, VerifyEmailSchema, ResendVerificationSchema, RefreshSessionSchema } from './Auth.validator.js';

const openSignup = {
  name: 'Ada',
  surname: 'Lovelace',
  email: 'ADA@example.com',
  password: 'secret123',
  phone: '08012345678',
  tnc: true,
};

describe('SignupSchema', () => {
  it('accepts open signup without a reservation code', () => {
    const parsed = SignupSchema.parse(openSignup);
    assert.equal(parsed.email, 'ada@example.com');
    assert.equal(parsed.tnc, true);
    assert.equal('reservationCode' in parsed, false);
  });

  it('ignores a retired reservation code and keeps campaign attribution', () => {
    const parsed = SignupSchema.parse({ ...openSignup, reservationCode: 'ABC123', campaign: 'gc_launch' });
    assert.equal(parsed.reservationCode, undefined);
    assert.equal(parsed.campaign, 'gc_launch');
  });

  it('requires explicit terms consent', () => {
    assert.throws(() => SignupSchema.parse({ ...openSignup, tnc: false }), /Terms of Service/);
    assert.throws(() => {
      const { tnc, ...rest } = openSignup;
      SignupSchema.parse(rest);
    });
  });
});

describe('VerifyEmailSchema', () => {
  it('accepts 64-character hex tokens only', () => {
    assert.equal(VerifyEmailSchema.parse({ token: 'a'.repeat(64) }).token.length, 64);
    assert.throws(() => VerifyEmailSchema.parse({ token: 'short' }));
    assert.throws(() => VerifyEmailSchema.parse({ token: 'g'.repeat(64) }));
  });
});

describe('ResendVerificationSchema', () => {
  it('normalizes email casing and rejects invalid addresses', () => {
    assert.equal(ResendVerificationSchema.parse({ email: 'ADA@example.com' }).email, 'ada@example.com');
    assert.throws(() => ResendVerificationSchema.parse({ email: 'not-an-email' }));
  });
});

describe('RefreshSessionSchema', () => {
  it('accepts an omitted or well-formed body token and rejects junk', () => {
    assert.equal(RefreshSessionSchema.parse({}).refreshToken, undefined);
    assert.equal(
      RefreshSessionSchema.parse({ refreshToken: `  ${'r'.repeat(48)}  ` }).refreshToken,
      'r'.repeat(48),
    );
    assert.throws(() => RefreshSessionSchema.parse({ refreshToken: 123 }));
    assert.throws(() => RefreshSessionSchema.parse({ refreshToken: 'short' }));
  });
});
