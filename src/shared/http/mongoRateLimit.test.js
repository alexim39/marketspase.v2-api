import test from 'node:test';
import assert from 'node:assert/strict';
import { mongoRateLimit } from './mongoRateLimit.js';

const res = () => {
  const out = { headers: {} };
  return {
    out,
    set(key, value) { out.headers[key] = value; return this; },
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
};

test('shared counter 429s after the budget and includes retry_after', async () => {
  let count = 0;
  const store = {
    hit: async () => ({ count: (count += 1), resetAt: new Date(Date.now() + 60_000) }),
  };
  const mw = mongoRateLimit({ name: 'test', max: 2, windowMs: 60_000, store, key: () => 'user:1' });
  const next = () => 'next';
  assert.equal(await mw({ ip: '1.1.1.1' }, res(), next), 'next');
  assert.equal(await mw({ ip: '1.1.1.1' }, res(), next), 'next');
  const r = res();
  await mw({ ip: '1.1.1.1' }, r, next);
  assert.equal(r.out.status, 429);
  assert.equal(r.out.body.code, 'RATE_LIMITED');
  assert.ok(r.out.body.retry_after >= 1);
  assert.ok(Number(r.out.headers['Retry-After']) >= 1);
});

test('store failure falls through to the in-memory limiter', async () => {
  const mw = mongoRateLimit({
    name: 'test-fail',
    store: { hit: async () => { throw new Error('db down'); } },
  });
  assert.equal(await mw({}, res(), () => 'next'), 'next');
});
