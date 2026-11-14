import crypto from 'crypto';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const storeServiceFeePercent = () => {
  const value = Number(process.env.STORE_SERVICE_FEE_PERCENT ?? 2);
  return clamp(Number.isFinite(value) ? value : 2, 0, 20);
};

export const storeEscrowHoldDays = () => {
  const value = Number(process.env.STORE_ESCROW_HOLD_DAYS ?? 7);
  return clamp(Number.isFinite(value) ? Math.round(value) : 7, 0, 60);
};

export const storeAutoDeliverDays = () => {
  const value = Number(process.env.STORE_AUTO_DELIVER_DAYS ?? 10);
  return clamp(Number.isFinite(value) ? Math.round(value) : 10, 0, 60);
};

export const storeReturnWindowDays = () => {
  const value = Number(process.env.STORE_RETURN_WINDOW_DAYS ?? 7);
  return clamp(Number.isFinite(value) ? Math.round(value) : 7, 0, 60);
};

export const storeOrderTtlMinutes = () => {
  const value = Number(process.env.STORE_ORDER_TTL_MINUTES ?? 30);
  return clamp(Number.isFinite(value) ? Math.round(value) : 30, 5, 120);
};

export const toKobo = (naira) => Math.round((Number(naira) || 0) * 100);
export const fromKobo = (kobo) => Math.round(Number(kobo) || 0) / 100;

export const storeCheckoutReturnUrl = () => {
  const configured = String(process.env.STORE_CHECKOUT_RETURN_URL ?? '').trim();
  if (configured) return configured;
  if (String(process.env.NODE_ENV ?? '').toLowerCase() === 'production') {
    return 'https://store.marketspase.com/checkout/result';
  }
  return 'http://localhost:4201/checkout/result';
};

export const newStoreOrderReference = () => (
  `MS${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(6).toString('hex').toUpperCase()}`
);

export const newStoreOrderNumber = (now = new Date()) => {
  const stamp = [
    String(now.getUTCFullYear()).slice(-2),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
  return `MS-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

export const storePricing = ({ merchandiseKobo, deliveryKobo = 0, percent = storeServiceFeePercent() }) => {
  const merchandise = Math.max(Math.round(Number(merchandiseKobo) || 0), 0);
  const delivery = Math.max(Math.round(Number(deliveryKobo) || 0), 0);
  const total = merchandise + delivery;
  const serviceFeeKobo = Math.round((merchandise * percent) / 100);
  return {
    merchandiseKobo: merchandise,
    deliveryKobo: delivery,
    totalKobo: total,
    serviceFeeKobo,
    serviceFeePercent: percent,
    partnerPendingKobo: total - serviceFeeKobo,
  };
};
