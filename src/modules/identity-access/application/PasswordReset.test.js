import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWTTOKENSECRET ??= 'test-secret-for-reset-suite';

const { RequestPasswordResetUseCase, ResetPasswordUseCase } = await import('./PasswordReset.usecase.js');
const { BcryptPasswordHasher } = await import('../infrastructure/Auth.crypto.js');

const hasher = new BcryptPasswordHasher();

const fakePartners = (seed = {}) => {
  const rows = new Map(Object.entries(seed));
  return {
    rows,
    findByEmail: async (email) => rows.get(String(email).toLowerCase()) ?? null,
    updateById: async (id, patch) => {
      for (const [email, row] of rows) {
        if (String(row._id ?? row.id) === String(id)) {
          const next = { ...row };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete next[k];
            else next[k] = v;
          }
          rows.set(email, next);
          return next;
        }
      }
      return null;
    },
  };
};

const user = (over = {}) => ({
  _id: 'u1', email: 'a@x.test', password: 'old-hash',
  resetPasswordToken: undefined, resetPasswordExpires: undefined, ...over,
});

describe('RequestPasswordResetUseCase', () => {
  it('unknown email still succeeds (anti-enumeration), sends nothing', async () => {
    let mailed = 0;
    const uc = new RequestPasswordResetUseCase({
      partners: fakePartners({}), mailer: { notifyPasswordReset: async () => { mailed += 1; } },
      frontendUrl: 'https://c21fg.online',
    });
    const res = await uc.execute({ email: 'ghost@x.test' });
    assert.deepEqual(res, { sent: false });
    assert.equal(mailed, 0);
  });

  it('known email persists token+expiry and mails the reset link', async () => {
    const partners = fakePartners({ 'a@x.test': user() });
    let mailedTo = null;
    let mailedUrl = null;
    const uc = new RequestPasswordResetUseCase({
      partners,
      mailer: { notifyPasswordReset: async (to, url) => { mailedTo = to; mailedUrl = url; } },
      frontendUrl: 'https://c21fg.online',
    });
    const res = await uc.execute({ email: 'A@X.test' });
    assert.deepEqual(res, { sent: true });
    const row = partners.rows.get('a@x.test');
    assert.ok(row.resetPasswordToken && row.resetPasswordToken.length > 10);
    assert.ok(new Date(row.resetPasswordExpires).getTime() > Date.now());
    assert.equal(mailedTo, 'a@x.test');
    assert.match(mailedUrl, /^https:\/\/c21fg\.online\/partner\/reset-password\?token=/);
  });

  it('known email + failed send fails honestly (503) instead of false success', async () => {
    const partners = fakePartners({ 'a@x.test': user() });
    const uc = new RequestPasswordResetUseCase({
      partners,
      mailer: { notifyPasswordReset: async () => ({ sent: false, error: 'Email is not configured' }) },
      frontendUrl: 'https://c21fg.online',
    });
    try {
      await uc.execute({ email: 'a@x.test' });
      assert.fail('must throw');
    } catch (err) {
      assert.equal(err.statusCode, 503);
      assert.match(err.message, /could not send the reset email/);
    }
  });

  it('known email + throwing mailer fails honestly (503)', async () => {
    const partners = fakePartners({ 'a@x.test': user() });
    const uc = new RequestPasswordResetUseCase({
      partners,
      mailer: { notifyPasswordReset: async () => { throw new Error('socket hangup'); } },
      frontendUrl: 'https://c21fg.online',
    });
    try {
      await uc.execute({ email: 'a@x.test' });
      assert.fail('must throw');
    } catch (err) {
      assert.equal(err.statusCode, 503);
    }
  });
});

describe('ResetPasswordUseCase', () => {
  const issue = async (partners, mailerUrl = 'https://c21fg.online') => {
    const req = new RequestPasswordResetUseCase({
      partners, mailer: { notifyPasswordReset: async () => {} }, frontendUrl: mailerUrl,
    });
    await req.execute({ email: 'a@x.test' });
    return partners.rows.get('a@x.test').resetPasswordToken;
  };

  it('valid token rotates the password and clears the token (single-use)', async () => {
    const partners = fakePartners({ 'a@x.test': user() });
    const token = await issue(partners);
    const uc = new ResetPasswordUseCase({ partners, hasher });
    const res = await uc.execute({ token, newPassword: 'newpass101' });
    assert.equal(res.message, 'Password successfully updated');
    const row = partners.rows.get('a@x.test');
    assert.equal('resetPasswordToken' in row, false);
    assert.equal('resetPasswordExpires' in row, false);
    assert.equal(await hasher.compare('newpass101', row.password), true);
    // replay must fail
    await assert.rejects(uc.execute({ token, newPassword: 'otherpass1' }), /Invalid or expired/);
  });

  it('rejects garbage tokens', async () => {
    const uc = new ResetPasswordUseCase({ partners: fakePartners({}), hasher });
    await assert.rejects(uc.execute({ token: 'not-a-jwt', newPassword: 'newpass101' }), /Invalid or expired/);
  });

  it('rejects expired tokens', async () => {
    const partners = fakePartners({ 'a@x.test': user() });
    const token = await issue(partners);
    partners.rows.get('a@x.test').resetPasswordExpires = new Date(Date.now() - 1000).toISOString();
    const uc = new ResetPasswordUseCase({ partners, hasher });
    await assert.rejects(uc.execute({ token, newPassword: 'newpass101' }), /Invalid or expired/);
  });

  it('requires token and password', async () => {
    const uc = new ResetPasswordUseCase({ partners: fakePartners({}), hasher });
    await assert.rejects(uc.execute({ token: '', newPassword: 'newpass101' }), /required/);
    await assert.rejects(uc.execute({ token: 'x'.repeat(20), newPassword: '' }), /required/);
  });
});
