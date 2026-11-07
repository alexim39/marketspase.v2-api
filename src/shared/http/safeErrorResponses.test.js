import test from 'node:test';
import assert from 'node:assert/strict';
import { safeErrorResponses } from './safeErrorResponses.js';

const makeRes = () => {
  const out = { headers: {} };
  const res = {
    out,
    statusCode: 500,
    set(key, value) { out.headers[key] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(body) { out.body = body; return res; },
    send(body) { out.body = body; return res; },
  };
  safeErrorResponses({ id: 'req-1' }, res, () => {});
  return res;
};

test('legacy 500s lose error and stack and gain code/fix/requestId', () => {
  const res = makeRes();
  res.status(500).json({ message: 'db exploded', error: 'stack at Foo', stack: 'trace', success: false });
  assert.equal(res.out.body.message, 'Internal server error');
  assert.equal(res.out.body.code, 'INTERNAL_ERROR');
  assert.equal(res.out.body.requestId, 'req-1');
  assert.ok(res.out.body.fix);
  assert.equal(res.out.body.error, undefined);
  assert.equal(res.out.body.stack, undefined);
});

test('400 messages stay useful and gain a fix', () => {
  const res = makeRes();
  res.status(400).json({ message: 'Account number must be 10 digits', success: false });
  assert.equal(res.out.body.message, 'Account number must be 10 digits');
  assert.equal(res.out.body.code, 'VALIDATION_ERROR');
  assert.ok(res.out.body.fix);
});

test('success arrays gain meta but keep their data and success', () => {
  const res = makeRes();
  res.statusCode = 200;
  res.status(200).json({ data: [1], success: true });
  assert.deepEqual(res.out.body.data, [1]);
  assert.equal(res.out.body.success, true);
  assert.equal(res.out.body.meta.count, 1);
});
