import mongoose from 'mongoose';
// Strangler reuse: same collections as legacy (commissions is NEW).
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { ProductModel, CartModel } from '../../../apps/product/models/product.model.js';

export { PartnersModel, TransactionModel, ProductModel, CartModel };

export const runInTransaction = async (fn) => {
  if (mongoose.connection?.readyState !== 1) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};
