import { partnerCapabilities } from '../../../modules/identity-access/domain/PartnerCapabilities.js';

/** A partner can buy at partner price only while active and verified. */
export const canBuyResale = (partner) => partnerCapabilities(partner).canBuyResale;

/**
 * Resolve the prices used for a resale line. `retailPrice` is the suggested
 * retail; fall back to the normal product price when it has not been set.
 */
export const resalePrices = (product) => {
  const partnerPrice = Math.max(Number(product?.partnerPrice) || 0, 0);
  const suggested = Number(product?.retailPrice) || Number(product?.price) || 0;
  return {
    partnerPrice,
    retailPrice: Math.max(suggested, 0),
  };
};

/** Top-level cart label for mixed personal/resale carts. */
export const cartSaleMode = (items = []) => {
  const modes = new Set(items.map((item) => (item?.saleMode === 'resale' ? 'resale' : 'personal')));
  if (modes.size > 1) return 'mixed';
  return modes.has('resale') ? 'resale' : 'personal';
};
