import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorMiddleware } from './errorMiddleware.js';
import { AppError } from '../domain/AppError.js';

const res = () => {
  const out = {};
  return {
    out,
    status(code) {
      out.status = code;
      return { json: (body) => { out.body = body; } };
    },
  };
};

describe('errorMiddleware', () => {
  it('maps AppError with code + details', () => {
    const r = res();
    errorMiddleware(new AppError('Nope', 403, 'FORBIDDEN', { a: 1 }), null, r, null);
    assert.equal(r.out.status, 403);
    assert.equal(r.out.body.message, 'Nope');
    assert.equal(r.out.body.code, 'FORBIDDEN');
  });

  it('honors plain provider errors with intentional statusCode (Ora 503)', () => {
    const r = res();
    const err = new Error('Ora is not configured yet (missing API key)');
    err.statusCode = 503;
    err.code = 'ORA_NOT_CONFIGURED';
    errorMiddleware(err, null, r, null);
    assert.equal(r.out.status, 503);
    assert.equal(r.out.body.message, 'Ora is not configured yet (missing API key)');
    assert.equal(r.out.body.code, 'ORA_NOT_CONFIGURED');
  });

  it('keeps uncoded 5xx generic (no internals leak)', () => {
    const r = res();
    const err = new Error('socket hang up at FooService.connect:49152');
    err.statusCode = 500;
    errorMiddleware(err, null, r, null);
    assert.equal(r.out.status, 500);
    assert.equal(r.out.body.message, 'Internal server error');
  });

  it('keeps axios-style failures generic', () => {
    const r = res();
    const err = new Error('timeout of 30000ms exceeded');
    err.code = 'ECONNABORTED';
    err.response = { status: 504 };
    errorMiddleware(err, null, r, null);
    assert.equal(r.out.status, 500);
    assert.equal(r.out.body.code, 'INTERNAL_ERROR');
  });
});
