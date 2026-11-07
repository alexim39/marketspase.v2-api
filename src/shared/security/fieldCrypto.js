import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';

const keyMaterial = () =>
  process.env.PII_ENCRYPTION_KEY
  || process.env.KYC_HASH_SECRET
  || process.env.JWTTOKENSECRET
  || 'marketspase-local-pii-key';

const key = () => crypto.createHash('sha256').update(String(keyMaterial())).digest();

export const isSealed = (value) =>
  typeof value === 'string' && value.startsWith(PREFIX);

/**
 * AES-256-GCM field encryption. The raw value never enters logs, and legacy
 * plaintext rows keep working until a migration seals them.
 */
export const seal = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text) return null;
  if (isSealed(text)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
};

export const open = (value) => {
  if (value === null || value === undefined) return null;
  if (!isSealed(value)) return value;
  try {
    const [ivPart, tagPart, dataPart] = String(value).slice(PREFIX.length).split(':');
    if (!ivPart || !tagPart || !dataPart) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
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
