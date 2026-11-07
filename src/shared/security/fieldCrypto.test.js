import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  activeKeyId, isSealed, keyIdOf, last4, mask, open, rewrap, seal,
} from './fieldCrypto.js';

const withEnv = (patch, fn) => {
  const previous = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
};

test('seals and opens a field without leaving plaintext', () => {
  const sealed = seal('0123456789');
  assert.ok(isSealed(sealed));
  assert.match(sealed, /^enc:v2:/);
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
  assert.equal(rewrap(sealed), sealed);
});

test('legacy v1 ciphertext stays readable and rewraps to the active key', () => {
  withEnv({
    PII_ENCRYPTION_KEY: 'legacy-secret',
    KYC_HASH_SECRET: undefined,
    JWTTOKENSECRET: undefined,
    PII_ENCRYPTION_KEYS: undefined,
    PII_ACTIVE_KEY_ID: undefined,
  }, () => {
    const key = crypto.createHash('sha256').update('legacy-secret').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update('0123456789', 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const v1 = `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;

    assert.equal(keyIdOf(v1), 'legacy');
    assert.equal(open(v1), '0123456789');
    const rotated = rewrap(v1);
    assert.match(rotated, /^enc:v2:default:/);
    assert.equal(open(rotated), '0123456789');
  });
});

test('keyring reads old keys and rewraps to the active key', () => {
  withEnv({
    PII_ENCRYPTION_KEY: undefined,
    KYC_HASH_SECRET: undefined,
    JWTTOKENSECRET: undefined,
    PII_ENCRYPTION_KEYS: JSON.stringify({ '2025-01': 'old-secret', '2026-11': 'new-secret' }),
    PII_ACTIVE_KEY_ID: '2025-01',
  }, () => {
    const old = seal('0123456789');
    assert.match(old, /^enc:v2:2025-01:/);
    assert.equal(activeKeyId(), '2025-01');

    process.env.PII_ACTIVE_KEY_ID = '2026-11';
    assert.equal(activeKeyId(), '2026-11');
    assert.equal(open(old), '0123456789');

    const rotated = rewrap(old);
    assert.match(rotated, /^enc:v2:2026-11:/);
    assert.equal(open(rotated), '0123456789');

    // Retire the old key after rewrap: old ciphertext fails closed, the
    // rotated value still opens.
    process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ '2026-11': 'new-secret' });
    assert.equal(open(old), null);
    assert.equal(open(rotated), '0123456789');
  });
});

test('keyring keeps pre-rotation default values readable', () => {
  withEnv({
    PII_ENCRYPTION_KEY: 'legacy-secret',
    KYC_HASH_SECRET: undefined,
    JWTTOKENSECRET: undefined,
    PII_ENCRYPTION_KEYS: undefined,
    PII_ACTIVE_KEY_ID: undefined,
  }, () => {
    const old = seal('0123456789');
    assert.match(old, /^enc:v2:default:/);

    process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ '2026-11': 'new-secret' });
    process.env.PII_ACTIVE_KEY_ID = '2026-11';

    assert.equal(open(old), '0123456789');
    const rotated = rewrap(old);
    assert.match(rotated, /^enc:v2:2026-11:/);
    assert.equal(open(rotated), '0123456789');
  });
});

test('unknown key ids fail closed and rewrap throws', () => {
  const value = 'enc:v2:missing:aaaa:bbbb:cccc';
  assert.equal(open(value), null);
  assert.equal(keyIdOf(value), 'missing');
  assert.throws(() => rewrap(value), /Unknown PII key id/);
});

test('a malformed keyring configuration fails fast', () => {
  withEnv({
    PII_ENCRYPTION_KEYS: JSON.stringify({ '2026-11': 'new-secret' }),
    PII_ACTIVE_KEY_ID: 'missing',
  }, () => {
    assert.throws(() => seal('abc'), /not in PII_ENCRYPTION_KEYS/);
  });
});

test('the pair keyring format is supported', () => {
  withEnv({
    PII_ENCRYPTION_KEY: undefined,
    KYC_HASH_SECRET: undefined,
    JWTTOKENSECRET: undefined,
    PII_ENCRYPTION_KEYS: '2025-01:old-secret,2026-11:new-secret',
    PII_ACTIVE_KEY_ID: '2026-11',
  }, () => {
    const sealed = seal('abc');
    assert.match(sealed, /^enc:v2:2026-11:/);
    assert.equal(open(sealed), 'abc');
  });
});
