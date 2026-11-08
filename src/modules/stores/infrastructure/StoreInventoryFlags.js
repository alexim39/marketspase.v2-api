import { StoreModel, StoreProductModel } from './Store.models.js';

/**
 * Keep the denormalised directory flag current after any listing/stock
 * mutation. Safe to call inside or outside a transaction; failures are
 * deliberately swallowed by callers so a sale never fails on a cache write.
 */
export const refreshStoreInStock = async (storeId, { session } = {}) => {
  if (!storeId) return 0;
  const count = await StoreProductModel.countDocuments(
    { storeId, status: 'published', stock: { $gt: 0 } },
    session ? { session } : {},
  );
  await StoreModel.updateOne(
    { _id: storeId },
    { $set: { inStockCount: count } },
    session ? { session } : {},
  );
  return count;
};
