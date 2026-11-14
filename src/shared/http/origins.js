const DEFAULT_ORIGINS = Object.freeze([
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4202',
  'http://localhost:4203',
  'https://c21fg.online',
  'https://www.c21fg.online',
  'https://marketspase.com',
  'https://www.marketspase.com',
  'https://store.marketspase.com',
  'https://www.store.marketspase.com',
  'https://admin.marketspase.com',
  'https://survey.c21fg.online',
  'https://shop.c21fg.online',
  'https://diamondproject.c21fg.online',
]);

/** One allowlist for CORS and CSRF Origin checks. */
export const allowedOrigins = () => {
  const extra = String(process.env.EXTRA_CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
};

export const normalizeOrigin = (value) => {
  try {
    return new URL(String(value)).origin;
  } catch {
    return null;
  }
};

export const isAllowedOrigin = (value) => {
  const origin = normalizeOrigin(value);
  return Boolean(origin && allowedOrigins().includes(origin));
};

export const originFromReferer = (referer) => {
  if (!referer) return null;
  return normalizeOrigin(referer);
};
