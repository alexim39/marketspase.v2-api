import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validate, validateBodyInPlace } from './validate.js';

const run = (middleware, req) => {
  let nextArg;
  middleware(req, {}, (err) => { nextArg = err; });
  return nextArg;
};

test('validateBodyInPlace replaces req.body with typed, stripped values', () => {
  const schema = z.object({
    name: z.string().trim(),
    count: z.coerce.number().int(),
  });
  const req = { body: { name: '  Ada  ', count: '3', $where: 'x', deletedAt: new Date() } };

  const error = run(validateBodyInPlace(schema), req);

  assert.equal(error, undefined);
  assert.deepEqual(req.body, { name: 'Ada', count: 3 });
});

test('validateBodyInPlace returns a safe 400 on invalid input', () => {
  const schema = z.object({ name: z.string().min(2) });
  const req = { body: { name: 'A' } };

  const error = run(validateBodyInPlace(schema), req);

  assert.equal(error?.statusCode, 400);
  assert.equal(error?.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(error?.details?.issues));
});

test('validateBodyInPlace treats a missing body as empty input', () => {
  const schema = z.object({ name: z.string().optional() });
  const req = {};

  const error = run(validateBodyInPlace(schema), req);

  assert.equal(error, undefined);
  assert.deepEqual(req.body, {});
});

test('validate keeps the validated payload off the raw body', () => {
  const schema = z.object({ name: z.string().trim() });
  const req = { body: { name: ' Ada ', $where: 'x' }, params: {}, query: {} };

  const error = run(validate({ body: schema }), req);

  assert.equal(error, undefined);
  assert.deepEqual(req.body, { name: ' Ada ', $where: 'x' });
  assert.deepEqual(req.validated.body, { name: 'Ada' });
});
