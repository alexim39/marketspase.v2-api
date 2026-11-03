import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWTTOKENSECRET ??= 'test-secret-for-auth-suite';

const { requireAuth, bearerToken } = await import('./requireAuth.js');
const { setRevocationChecker } = await import('../../modules/identity-access/infrastructure/SessionRevocation.js');
const jwt = (await import('jsonwebtoken')).default;

// No Mongo here — revocation checks default to "not revoked".
setRevocationChecker(async () => false);

const run = (req) => new Promise((resolve) => {
  const next = (err) => resolve(err ?? null);
  requireAuth(req, {}, next);
});

describe('bearerToken', () => {
  it('extracts Bearer tokens case-insensitively', () => {
    assert.equal(bearerToken({ headers: { authorization: 'Bearer abc.def' } }), 'abc.def');
    assert.equal(bearerToken({ headers: { authorization: 'bearer xyz' } }), 'xyz');
  });

  it('returns null for missing/malformed headers', () => {
    assert.equal(bearerToken({ headers: {} }), null);
    assert.equal(bearerToken({}), null);
    assert.equal(bearerToken({ headers: { authorization: 'Basic abc' } }), null);
    assert.equal(bearerToken({ headers: { authorization: 'Bearer ' } }), null);
  });
});

describe('requireAuth transports', () => {
  let token;
  before(() => {
    token = jwt.sign({ id: 'partner1' }, process.env.JWTTOKENSECRET);
  });

  it('accepts the cookie (primary transport)', async () => {
    let authed = null;
    const req = { cookies: { jwt: token }, headers: {} };
    const err = await new Promise((resolve) => {
      requireAuth(req, {}, (e) => { authed = req.auth; resolve(e ?? null); });
    });
    assert.equal(err, null);
    assert.deepEqual(authed, { partnerId: 'partner1' });
  });

  it('accepts the Bearer header when the cookie is absent', async () => {
    let authed = null;
    const req = { cookies: {}, headers: { authorization: `Bearer ${token}` } };
    const err = await new Promise((resolve) => {
      requireAuth(req, {}, (e) => { authed = req.auth; resolve(e ?? null); });
    });
    assert.equal(err, null);
    assert.deepEqual(authed, { partnerId: 'partner1' });
  });

  it('prefers the cookie over the header', async () => {
    const other = jwt.sign({ id: 'partner2' }, process.env.JWTTOKENSECRET);
    let authed = null;
    const req = { cookies: { jwt: token }, headers: { authorization: `Bearer ${other}` } };
    await new Promise((resolve) => {
      requireAuth(req, {}, () => { authed = req.auth; resolve(); });
    });
    assert.deepEqual(authed, { partnerId: 'partner1' });
  });

  it('rejects with neither transport', async () => {
    const err = await run({ cookies: {}, headers: {} });
    assert.match(err?.message ?? '', /No authentication token/);
  });

  it('rejects tampered Bearer tokens', async () => {
    const err = await run({ cookies: {}, headers: { authorization: 'Bearer tampered.payload.sig' } });
    assert.match(err?.message ?? '', /Invalid or expired/);
  });

  it('rejects revoked sessions on the next call', async () => {
    setRevocationChecker(async (id) => id === 'partner9');
    const token = jwt.sign({ id: 'partner9' }, process.env.JWTTOKENSECRET);
    const err = await run({ cookies: { jwt: token }, headers: {} });
    assert.match(err?.message ?? '', /revoked/);
    setRevocationChecker(async () => false);
  });
});
