import crypto from 'node:crypto';

const V1_PREFIX = 'enc:v1:';
const V2_PREFIX = 'enc:v2:';
const DEFAULT_KEY_ID = 'default';
const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

const legacyMaterial = () =>
  process.env.PII_ENCRYPTION_KEY
  || process.env.KYC_HASH_SECRET
  || process.env.JWTTOKENSECRET
  || 'marketspase-local-pii-key';

const deriveKey = (material) => crypto
  .createHash('sha256')
  .update(String(material))
  .digest();

const parseKeyring = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed)
        .map(([id, material]) => [String(id).trim(), String(material ?? '')])
        .filter(([id, material]) => id && material);
    }
  } catch { /* fall through to the pair format */ }

  return raw.split(',')
    .map((pair) => {
      const separator = pair.indexOf(':');
      if (separator <= 0) return null;
      return [pair.slice(0, separator).trim(), pair.slice(separator + 1).trim()];
    })
    .filter(([id, material]) => id && material);
};

const buildKeyring = () => {
  const raw = String(process.env.PII_ENCRYPTION_KEYS ?? '').trim();
  const legacyKey = deriveKey(legacyMaterial());

  if (!raw) {
    return {
      activeId: DEFAULT_KEY_ID,
      keys: new Map([[DEFAULT_KEY_ID, legacyKey]]),
      legacyKeys: [legacyKey],
    };
  }

  const entries = parseKeyring(raw);
  if (entries.length === 0) {
    throw new Error('PII_ENCRYPTION_KEYS is set but contains no usable keys');
  }

  const keys = new Map();
  for (const [id, material] of entries) {
    if (!KEY_ID_RE.test(id)) throw new Error(`Invalid PII key id: ${id}`);
    if (keys.has(id)) throw new Error(`Duplicate PII key id: ${id}`);
    keys.set(id, deriveKey(material));
  }
  // Values written before the keyring existed use id `default` with material
  // from PII_ENCRYPTION_KEY (or its fallbacks). Keep that key available so the
  // first rotation can still read and re-wrap them.
  if (!keys.has(DEFAULT_KEY_ID)) keys.set(DEFAULT_KEY_ID, legacyKey);

  const requested = String(process.env.PII_ACTIVE_KEY_ID ?? '').trim();
  const activeId = requested || entries[0][0];
  if (!keys.has(activeId)) {
    throw new Error(`PII_ACTIVE_KEY_ID "${activeId}" is not in PII_ENCRYPTION_KEYS`);
  }

  // v1 ciphertext has no key id, so try every configured key plus the
  // legacy env-derived key. This keeps pre-keyring rows readable during the
  // first rotation.
  const legacyKeys = [];
  const seen = new Set();
  for (const key of [legacyKey, ...keys.values()]) {
    const fingerprint = key.toString('hex');
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    legacyKeys.push(key);
  }

  return { activeId, keys, legacyKeys };
};

let cache = { signature: null, activeId: DEFAULT_KEY_ID, keys: new Map(), legacyKeys: [] };

const getKeyring = () => {
  const signature = [
    process.env.PII_ENCRYPTION_KEY ?? '',
    process.env.KYC_HASH_SECRET ?? '',
    process.env.JWTTOKENSECRET ?? '',
    process.env.PII_ENCRYPTION_KEYS ?? '',
    process.env.PII_ACTIVE_KEY_ID ?? '',
  ].join('\u0000');
  if (cache.signature !== signature) {
    cache = { signature, ...buildKeyring() };
  }
  return cache;
};

const parseSealed = (value) => {
  const text = String(value ?? '');
  if (text.startsWith(V1_PREFIX)) {
    const [iv, tag, data, ...rest] = text.slice(V1_PREFIX.length).split(':');
    if (!iv || !tag || !data || rest.length > 0) return null;
    return { version: 1, iv, tag, data };
  }
  if (text.startsWith(V2_PREFIX)) {
    const [keyId, iv, tag, data, ...rest] = text.slice(V2_PREFIX.length).split(':');
    if (!keyId || !iv || !tag || !data || rest.length > 0) return null;
    return { version: 2, keyId, iv, tag, data };
  }
  return null;
};

const decryptWith = (parsed, key) => {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(parsed.iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
};

export const isSealed = (value) =>
  typeof value === 'string'
  && (value.startsWith(V1_PREFIX) || value.startsWith(V2_PREFIX));

export const activeKeyId = () => getKeyring().activeId;

/** Returns the key id used by a sealed value, or `legacy` for v1 values. */
export const keyIdOf = (value) => {
  if (!isSealed(value)) return null;
  const parsed = parseSealed(value);
  if (!parsed) return null;
  return parsed.version === 2 ? parsed.keyId : 'legacy';
};

/**
 * AES-256-GCM field encryption. New values carry the active key id:
 * `enc:v2:<keyId>:<iv>:<tag>:<ciphertext>`. Legacy `enc:v1:` values remain
 * readable during rotation.
 */
export const seal = (value) => {
  if (value === null || value === undefined) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (!text) return null;
  if (isSealed(text)) return text;

  const ring = getKeyring();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ring.keys.get(ring.activeId), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${V2_PREFIX}${ring.activeId}:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
};

export const open = (value) => {
  if (value === null || value === undefined) return null;
  if (!isSealed(value)) return value;

  const parsed = parseSealed(value);
  if (!parsed) return null;
  const ring = getKeyring();

  if (parsed.version === 1) {
    for (const key of ring.legacyKeys) {
      const plain = decryptWith(parsed, key);
      if (plain !== null) return plain;
    }
    return null;
  }

  const key = ring.keys.get(parsed.keyId);
  return key ? decryptWith(parsed, key) : null;
};

/**
 * Re-encrypt a value with the active key. Plaintext is sealed; values already
 * using the active key are returned unchanged; old keys are only read.
 * Throws when a ciphertext names a key that is no longer in the keyring.
 */
export const rewrap = (value) => {
  if (value === null || value === undefined) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (!text) return null;
  if (!isSealed(text)) return seal(text);

  const parsed = parseSealed(text);
  if (!parsed) throw new Error('Invalid sealed PII value');
  const ring = getKeyring();

  if (parsed.version === 2) {
    if (parsed.keyId === ring.activeId) return text;
    const key = ring.keys.get(parsed.keyId);
    if (!key) throw new Error(`Unknown PII key id: ${parsed.keyId}`);
    const plain = decryptWith(parsed, key);
    if (plain === null) throw new Error(`Could not decrypt PII value with key ${parsed.keyId}`);
    return seal(plain);
  }

  for (const key of ring.legacyKeys) {
    const plain = decryptWith(parsed, key);
    if (plain !== null) return seal(plain);
  }
  throw new Error('Could not decrypt legacy PII value with any configured key');
};

export const mask = (value, visible = 4) => {
  const plain = open(value);
  if (!plain) return null;
  const text = String(plain);
  if (text.length <= visible) return text;
  return `${'•'.repeat(Math.max(0, text.length - visible))}${text.slice(-visible)}`;
};

export const last4 = (value) => {
  const plain = open(value);
  if (!plain) return null;
  return String(plain).slice(-4);
};
