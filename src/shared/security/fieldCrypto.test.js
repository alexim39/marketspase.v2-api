import test from 'node:test';
import assert from 'node:assert/strict';
import { isSealed, last4, mask, open, seal } from './fieldCrypto.js';

test('seals and opens a field without leaving plaintext', () => {
  const sealed = seal('0123456789');
  assert.ok(isSealed(sealed));
  assert.equal(sealed.includes('0123456789'), false);
  assert.equal(open(sealed), '0123456789');
  assert.equal(last4(sealed), '6789');
  assert.match(mask(sealed), /•+6789$/);
});

test('legacy plaintext passes through and null stays null', () => {
  assert.equal(open('0123456789'), '0123456789');
  assert.equal(seal(null), null);
  assert.equal(seal(''), null);
  assert.equal(open(null), null);
});

test('a sealed value is idempotent', () => {
  const sealed = seal('abc');
  assert.equal(seal(sealed), sealed);
});
