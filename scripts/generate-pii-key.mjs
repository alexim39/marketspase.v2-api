import crypto from 'node:crypto';

/**
 * Generates one new PII keyring entry. It prints ONLY the new key material —
 * never the existing default/legacy key.
 *
 * Usage:
 *   npm run pii:key -- rot1
 *
 * Add the printed `rot1:<key>` pair to PII_ENCRYPTION_KEYS while keeping the
 * existing `default` material readable, set PII_ACTIVE_KEY_ID=rot1, then run
 * the dry/apply PII migration.
 */
const id = String(process.argv[2] ?? 'rot1').trim();
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(id)) {
  console.error('Key id must match [A-Za-z0-9][A-Za-z0-9._-]{0,31}');
  process.exit(1);
}
const key = crypto.randomBytes(32).toString('base64url');
console.log(`${id}:${key}`);
