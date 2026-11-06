/** Only a finite numeric stock count is enforced; null means unlimited. */
export const isStockTracked = (product) => (
  typeof product?.stock === 'number' && Number.isFinite(product.stock)
);

/**
 * Combine cart lines by product so a product added once for personal use and
 * once for resale reserves the total quantity exactly once.
 */
export const aggregateStockRequirements = (items = []) => {
  const requirements = new Map();
  for (const item of items) {
    if (!item?.stockTracked) continue;
    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0) continue;
    const productId = String(item.product);
    requirements.set(productId, (requirements.get(productId) ?? 0) + quantity);
  }
  return requirements;
};
