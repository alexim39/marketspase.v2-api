import crypto from 'node:crypto';

/**
 * Customer order access tokens are derived from the order identity and a
 * server secret, so they never need to be stored in plaintext. The Paystack
 * reference alone is not enough to read an order.
 */
const tokenSecret = () => (
  process.env.STORE_ORDER_TOKEN_SECRET
  || process.env.JWTTOKENSECRET
  || 'marketspase-store-order-dev'
);

const payload = (order = {}) => (
  `${String(order._id ?? order.id ?? '')}:${String(order.reference ?? '')}`
);

export const storeOrderAccessToken = (order) => (
  crypto.createHmac('sha256', tokenSecret()).update(payload(order)).digest('base64url')
);

export const verifyStoreOrderAccessToken = (order, provided) => {
  const expected = storeOrderAccessToken(order);
  const actual = String(provided ?? '').trim();
  if (!actual || actual.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch {
    return false;
  }
};

/**
 * Canonical public storefront origin.
 *
 * Store pages are served by the store app, never by the platform host.
 * `PUBLIC_SITE_URL`/`APP_BASE_URL` describe the platform (campaign landing
 * pages, dashboard links) and must not be reused for customer order links.
 * Set `STORE_PUBLIC_URL` explicitly in deployed environments.
 */
export const storePublicUrl = () => {
  const configured = String(process.env.STORE_PUBLIC_URL ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const local = [
    process.env.FRONTEND_URL,
    process.env.PUBLIC_SITE_URL,
    process.env.APP_BASE_URL,
  ].some((value) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(value ?? '')));
  return local ? 'http://localhost:4201' : 'https://store.marketspase.com';
};

export const storeOrderTrackingUrl = (order) => (
  `${storePublicUrl()}/order/${encodeURIComponent(String(order?.reference ?? ''))}`
  + `?token=${encodeURIComponent(storeOrderAccessToken(order))}`
);
