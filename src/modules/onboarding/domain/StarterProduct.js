/**
 * Canonical starter-product facts. Kept dependency-free so Ora, onboarding
 * and tests can share the same price/name without importing route wiring.
 *
 * Two activation plans share one five-level commission table. The amount per
 * level differs because commission is a percentage of each plan's gross
 * margin. The Essential plan pays a lower mentor bonus to the upline; a
 * Signature mentor always earns at least the Signature rate (see
 * Compensation.plan.mentorBonusForTier).
 */
export const STARTER_PLAN_TIERS = Object.freeze({
  essential: 'essential',
  signature: 'signature',
});

const signatureImages = [
  { url: '/img/activation-hoodi.jpeg', alt: 'MarketSpase Signature hoodie - look one', order: 0 },
  { url: '/img/activation-hoodi2.jpeg', alt: 'MarketSpase Signature hoodie - look two', order: 1 },
];

const essentialImages = [
  { url: '/img/activation-clothe.jpeg', alt: 'MarketSpase Essential set - look one', order: 0 },
  { url: '/img/activation-clothe2.jpeg', alt: 'MarketSpase Essential set - look two', order: 1 },
  { url: '/img/activation-clothe3.jpeg', alt: 'MarketSpase Essential set - look three', order: 2 },
  { url: '/img/activation-clothe4.jpeg', alt: 'MarketSpase Essential set - look four', order: 3 },
  { url: '/img/activation-clothe5.jpeg', alt: 'MarketSpase Essential set - look five', order: 4 },
];

export const SIGNATURE_STARTER_PRODUCT = Object.freeze({
  sku: 'MS-STARTER-001',
  tier: STARTER_PLAN_TIERS.signature,
  name: 'MarketSpase Signature Clothing Set',
  description: 'A premium everyday clothing set, delivered nationwide. Activation includes business onboarding and access to the MarketSpase partner network.',
  price: 38000,
  currency: 'NGN',
  imageUrl: '/img/activation-hoodi.jpeg',
  images: signatureImages,
  shippingCost: 3000,
  cogs: 16000,
  mentorBonus: null,
  upgradeCredit: 0,
  active: true,
  sortOrder: 1,
});

export const ESSENTIAL_STARTER_PRODUCT = Object.freeze({
  sku: 'MS-STARTER-002',
  tier: STARTER_PLAN_TIERS.essential,
  name: 'MarketSpase Essential Clothing Set',
  description: 'A complete everyday clothing set for new partners, delivered nationwide. Activation includes business onboarding, the full partner workspace and access to the MarketSpase partner network.',
  price: 12500,
  currency: 'NGN',
  imageUrl: '/img/activation-clothe.jpeg',
  images: essentialImages,
  shippingCost: 2600,
  cogs: 4800,
  mentorBonus: 800,
  upgradeCredit: 12500,
  active: true,
  sortOrder: 2,
});

/** Display order intentionally anchors the Signature plan first. */
export const STARTER_PRODUCTS = Object.freeze([
  SIGNATURE_STARTER_PRODUCT,
  ESSENTIAL_STARTER_PRODUCT,
]);

/** Legacy single-plan export kept for existing imports. */
export const STARTER_PRODUCT = SIGNATURE_STARTER_PRODUCT;

/** Flat handling and second-delivery fee added to a lifetime upgrade. */
export const UPGRADE_HANDLING_FEE_NGN = 2500;

export const starterProductByTier = (tier) => (
  STARTER_PRODUCTS.find((product) => product.tier === tier) ?? null
);

export const starterProductBySku = (sku) => (
  STARTER_PRODUCTS.find((product) => product.sku === sku) ?? null
);

/**
 * Lifetime upgrade price = current Signature price - the amount the partner
 * already paid, plus handling and a second delivery. Never below zero.
 */
export const upgradePriceFor = ({
  signaturePrice,
  credit,
  handlingFee = UPGRADE_HANDLING_FEE_NGN,
}) => {
  const price = Math.max(Number(signaturePrice) || 0, 0);
  const applied = Math.min(Math.max(Number(credit) || 0, 0), price);
  return Math.max(Math.round((price - applied + handlingFee) * 100) / 100, 0);
};
