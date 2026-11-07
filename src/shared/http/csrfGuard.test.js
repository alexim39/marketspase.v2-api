import test from 'node:test';
import assert from 'node:assert/strict';
import { csrfGuard } from './csrfGuard.js';

const run = (req) => {
  let status = 200;
  let body = null;
  let nextCalled = false;
  const res = {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  csrfGuard(req, res, () => { nextCalled = true; });
  return { status, body, nextCalled };
};

test('GET is always safe', () => {
  assert.equal(run({ method: 'GET', headers: {}, cookies: {} }).nextCalled, true);
});

test('cookie mutation from an untrusted origin is blocked', () => {
  const out = run({
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    cookies: { jwt: 'x' },
  });
  assert.equal(out.nextCalled, false);
  assert.equal(out.status, 403);
  assert.equal(out.body.code, 'CSRF_ORIGIN_BLOCKED');
});

test('cookie mutation from an allowed origin passes', () => {
  const out = run({
    method: 'POST',
    headers: { origin: 'http://localhost:4200' },
    cookies: { jwt: 'x' },
  });
  assert.equal(out.nextCalled, true);
});

test('bearer requests do not need an origin', () => {
  const out = run({
    method: 'POST',
    headers: { authorization: 'Bearer x' },
    cookies: {},
  });
  assert.equal(out.nextCalled, true);
});
