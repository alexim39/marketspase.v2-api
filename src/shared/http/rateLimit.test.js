import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, rateLimit, resetRateLimits } from './rateLimit.js';

const req = (ip = '1.2.3.4') => ({ headers: {}, ip, socket: {} });
const res = () => {
  const out = { headers: {} };
  return {
    out,
    set: (k, v) => { out.headers[k] = v; },
    status(code) {
      out.status = code;
      return { json: (body) => { out.body = body; } };
    },
  };
};

describe('rateLimit', () => {
  it('allows under the limit, 429s over it with Retry-After', () => {
    resetRateLimits();
    const mw = rateLimit({ name: 't1', windowMs: 60000, max: 2 });
    let nexts = 0;
    const next = () => { nexts += 1; };
    mw(req(), res(), next);
    mw(req(), res(), next);
    const r = res();
    mw(req(), r, next);
    assert.equal(nexts, 2);
    assert.equal(r.out.status, 429);
    assert.equal(r.out.body.code, 'RATE_LIMITED');
    assert.ok(Number(r.out.headers['Retry-After']) >= 1);
  });

  it('namespaces buckets per route and keys by forwarded IP', () => {
    resetRateLimits();
    const a = rateLimit({ name: 'a', windowMs: 60000, max: 1 });
    const b = rateLimit({ name: 'b', windowMs: 60000, max: 1 });
    let nexts = 0;
    const next = () => { nexts += 1; };
    a(req(), res(), next);
    b(req(), res(), next); // different namespace — not counted against `a`
    assert.equal(nexts, 2);
    assert.equal(
      clientIp({ headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' }, ip: '2.2.2.2', socket: {} }),
      '9.9.9.9',
    );
  });

  it('never breaks the chain on internal failure', () => {
    resetRateLimits();
    const mw = rateLimit({ name: 't3', key: () => { throw new Error('boom'); } });
    let nexts = 0;
    mw(req(), res(), () => { nexts += 1; });
    assert.equal(nexts, 1);
  });
});
