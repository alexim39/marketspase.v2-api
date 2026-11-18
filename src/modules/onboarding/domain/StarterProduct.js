/**
 * Canonical starter-product facts. Kept dependency-free so Ora, onboarding
 * and tests can share the same price/name without importing route wiring.
 */
export const STARTER_PRODUCT = {
  sku: 'MS-STARTER-001',
  name: 'MarketSpase Signature Clothing Set',
  description: 'A premium everyday clothing set, delivered nationwide. Activation includes business onboarding and access to the MarketSpase partner network.',
  price: 38000,
  currency: 'NGN',
  imageUrl: '/img/activation-hoodi.jpeg',
  shippingCost: 3000,
  cogs: 16000,
  active: true,
  sortOrder: 1,
};
