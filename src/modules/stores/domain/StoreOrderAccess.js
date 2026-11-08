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

export const publicSiteUrl = () => String(
  process.env.PUBLIC_SITE_URL || process.env.APP_BASE_URL || 'https://marketspase.com',
).replace(/\/+$/, '');

export const storeOrderTrackingUrl = (order) => (
  `${publicSiteUrl()}/order/${encodeURIComponent(String(order?.reference ?? ''))}`
  + `?token=${encodeURIComponent(storeOrderAccessToken(order))}`
);
