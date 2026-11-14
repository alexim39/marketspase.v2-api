import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';

process.env.JWTTOKENSECRET ??= 'test-secret-for-auth-routes';

const { buildAuthRouter } = await import('./Auth.routes.js');
const { errorMiddleware } = await import('../../../shared/http/errorMiddleware.js');
const { UnauthorizedException } = await import('../../../shared/domain/AppError.js');

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

/** In-memory stand-in for the rotating refresh-session store. */
const refreshRows = new Map();
let refreshSeq = 0;

const issueRefresh = (partnerId, scope) => {
  const token = `refresh-${++refreshSeq}-${'r'.repeat(40)}`;
  refreshRows.set(token, { partnerId: String(partnerId), scope, revokedAt: null });
  return token;
};

const refreshSessions = {
  issue: async ({ partnerId, scope }) => ({
    token: issueRefresh(partnerId, scope),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }),
  rotate: async ({ token, scope }) => {
    const row = refreshRows.get(token);
    if (!row || row.revokedAt || row.scope !== scope) {
      throw new UnauthorizedException('Refresh session expired');
    }
    row.revokedAt = new Date();
    return {
      token: issueRefresh(row.partnerId, scope),
      partnerId: row.partnerId,
      scope,
    };
  },
  revoke: async ({ token, scope }) => {
    const row = refreshRows.get(token);
    if (!row || row.scope !== scope) return false;
    row.revokedAt = new Date();
    return true;
  },
};

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/v1/auth', buildAuthRouter({
  partners,
  hasher,
  sessions,
  refreshSessions,
  tx: { runInTransaction: async (fn) => fn(undefined) },
  tokens,
  verificationMailer,
  mailer: { notifyPasswordReset: async () => ({ sent: true }) },
  revocations: { clear: async () => {} },
  requestErasure: { execute: async () => ({}) },
  cancelErasure: { execute: async () => ({ cancelled: false }) },
  frontendUrl: 'http://localhost:4200',
  referralResolver: {
    resolve: async () => ({ ownerId: null, systemOwned: true, prospectId: null, source: 'organic' }),
    bindProspect: async () => ({ bound: false }),
  },
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
    assert.match(signedIn.body.data.refreshToken ?? '', /^refresh-/);
    assert.match(signedIn.headers.get('set-cookie') ?? '', /(?:^|,\s*)jwt=/);
    assert.match(signedIn.headers.get('set-cookie') ?? '', /(?:^|,\s*)refresh_jwt=/);

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

  it('rejects a malformed refresh body', async () => {
    const response = await post('/refresh', { refreshToken: 'short' });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
  });

  it('accepts signout without a body', async () => {
    const response = await post('/signout', undefined);
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
  });

  it('rotates and revokes sessions with a body token when cookies are unavailable', async () => {
    const signedIn = await post('/signin', { email: signupBody.email, password: signupBody.password });
    assert.equal(signedIn.status, 200);
    const firstRefresh = signedIn.body.data.refreshToken;
    assert.ok(firstRefresh);

    // No cookie jar in these requests: the body token is the only transport.
    const refreshed = await post('/refresh', { refreshToken: firstRefresh });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.data.token, 'jwt-token');
    assert.ok(refreshed.body.data.refreshToken);
    assert.notEqual(refreshed.body.data.refreshToken, firstRefresh);
    assert.match(refreshed.headers.get('set-cookie') ?? '', /refresh_jwt=/);

    // Rotation is single-use.
    const replay = await post('/refresh', { refreshToken: firstRefresh });
    assert.equal(replay.status, 401);

    const secondRefresh = refreshed.body.data.refreshToken;
    const signedOut = await post('/signout', { refreshToken: secondRefresh });
    assert.equal(signedOut.status, 200);

    const afterSignout = await post('/refresh', { refreshToken: secondRefresh });
    assert.equal(afterSignout.status, 401);
  });

  it('prefers the rotating body token over a stale refresh cookie', async () => {
    const first = await post('/signin', { email: signupBody.email, password: signupBody.password });
    const second = await post('/signin', { email: signupBody.email, password: signupBody.password });
    const staleCookie = first.body.data.refreshToken;
    const currentBody = second.body.data.refreshToken;
    assert.ok(staleCookie);
    assert.ok(currentBody);
    assert.notEqual(staleCookie, currentBody);

    // A refused Set-Cookie can leave an already-rotated cookie in the jar.
    const signedOut = await post(
      '/signout',
      { refreshToken: currentBody },
      { cookie: `refresh_jwt=${encodeURIComponent(staleCookie)}` },
    );
    assert.equal(signedOut.status, 200);

    const currentAfter = await post('/refresh', { refreshToken: currentBody });
    assert.equal(currentAfter.status, 401);
    const staleAfter = await post('/refresh', { refreshToken: staleCookie });
    assert.equal(staleAfter.status, 200);
  });
});
