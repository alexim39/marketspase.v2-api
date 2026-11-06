import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.JWTTOKENSECRET ??= 'test-secret-for-auth-routes';

const { buildAuthRouter } = await import('./Auth.routes.js');
const { errorMiddleware } = await import('../../../shared/http/errorMiddleware.js');

const mail = [];
const rows = new Map();

const partners = {
  findByEmail: async (email) => rows.get(String(email).toLowerCase()) ?? null,
  findById: async (id) => [...rows.values()].find((row) => String(row._id) === String(id)) ?? null,
  existsByUsername: async (username) => [...rows.values()].some((row) => row.username === username),
  create: async (data) => {
    const existing = rows.get(String(data.email).toLowerCase());
    if (existing) throw { code: 11000 };
    const row = { _id: `p-${rows.size + 1}`, ...data };
    rows.set(String(row.email).toLowerCase(), row);
    return row;
  },
  updateById: async (id, patch) => {
    const row = [...rows.values()].find((entry) => String(entry._id) === String(id));
    if (!row) return null;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete row[key];
      else row[key] = value;
    }
    return row;
  },
  consumeEmailVerificationToken: async (hash, now) => {
    for (const row of rows.values()) {
      if (row.emailVerificationTokenHash !== hash) continue;
      if (new Date(row.emailVerificationExpires).getTime() <= new Date(now).getTime()) continue;
      row.emailVerified = true;
      row.emailVerifiedAt = now;
      delete row.emailVerificationTokenHash;
      delete row.emailVerificationExpires;
      return row;
    }
    return null;
  },
  trackLogin: async () => null,
};

const tokens = {
  issue: () => ({
    token: 'a'.repeat(64),
    hash: `hashed:${'a'.repeat(64)}`,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }),
  hash: (token) => `hashed:${token}`,
};

const verificationMailer = {
  notifyVerification: async (to, url) => {
    mail.push({ to, url });
    return { sent: true };
  },
};

const hasher = {
  hash: async (plain) => `hashed:${plain}`,
  compare: async (plain, hash) => hash === `hashed:${plain}`,
};

const sessions = {
  sign: () => 'jwt-token',
  verify: () => 'p-1',
};

const app = express();
app.use(express.json());
app.use('/v1/auth', buildAuthRouter({
  partners,
  hasher,
  sessions,
  tx: { runInTransaction: async (fn) => fn(undefined) },
  tokens,
  verificationMailer,
  mailer: { notifyPasswordReset: async () => ({ sent: true }) },
  revocations: { clear: async () => {} },
  requestErasure: { execute: async () => ({}) },
  cancelErasure: { execute: async () => ({ cancelled: false }) },
  frontendUrl: 'http://localhost:4200',
}));
app.use(errorMiddleware);

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/v1/auth`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = async (path, body, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
};

const signupBody = {
  name: 'Ada',
  surname: 'Lovelace',
  email: 'ada@example.com',
  phone: '08012345678',
  password: 'secret123',
  tnc: true,
};

describe('open signup + email verification route flow', () => {
  it('registers without a reservation code, blocks sign-in until verified, verifies, then signs in', async () => {
    const signup = await post('/signup', signupBody);
    assert.equal(signup.status, 200);
    assert.equal(signup.body.success, true);
    assert.equal(signup.body.verificationSent, true);
    assert.equal(signup.body.userObject.emailVerified, false);
    assert.equal(mail.length, 1);
    assert.equal(mail[0].to, 'ada@example.com');

    const blocked = await post('/signin', { email: signupBody.email, password: signupBody.password });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'EMAIL_NOT_VERIFIED');

    const resend = await post('/resend-verification', { email: signupBody.email });
    assert.equal(resend.status, 200);
    assert.equal(resend.body.success, true);

    const token = new URL(mail[0].url).searchParams.get('token');
    assert.equal(token, 'a'.repeat(64));
    const verified = await post('/verify-email', { token });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.success, true);

    const signedIn = await post('/signin', { email: signupBody.email, password: signupBody.password });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.success, true);
    assert.equal(signedIn.body.data.token, 'jwt-token');
    assert.match(signedIn.headers.get('set-cookie') ?? '', /(?:^|,\s*)jwt=/);

    const adminSignedIn = await post(
      '/signin',
      { email: signupBody.email, password: signupBody.password },
      { 'x-client': 'admin' },
    );
    assert.equal(adminSignedIn.status, 200);
    assert.match(adminSignedIn.headers.get('set-cookie') ?? '', /(?:^|,\s*)admin_jwt=/);
  });

  it('rejects duplicate registration with a conflict envelope', async () => {
    const duplicate = await post('/signup', signupBody);
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'CONFLICT');
  });

  it('requires terms consent', async () => {
    const { tnc, ...withoutTerms } = signupBody;
    const response = await post('/signup', { ...withoutTerms, email: 'new@example.com' });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
  });

  it('rejects malformed verification tokens', async () => {
    const response = await post('/verify-email', { token: 'short' });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
  });
});
