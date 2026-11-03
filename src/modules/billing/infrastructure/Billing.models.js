import mongoose from 'mongoose';
// Strangler reuse: same collections as legacy (commissions is NEW).
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { ProductModel, CartModel } from '../../../apps/product/models/product.model.js';

export { PartnersModel, TransactionModel, ProductModel, CartModel };

const commissionSchema = new mongoose.Schema(
  {
    cartId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    level: { type: Number, required: true, min: 1, max: 5 },
    rate: { type: Number, required: true },
    amount: { type: Number, required: true, min: 0 },
    purchaseTotal: { type: Number, required: true, min: 0 },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    buyerUsername: { type: String, default: '' },
    buyerName: { type: String, default: '' },
    earnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    earnerPlan: { type: String, default: 'Basic' }, // recorded for future differentials (no gating v1)
    status: { type: String, default: 'Pending', index: true },
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    releasedAt: { type: Date },
  },
  { timestamps: true },
);
// Idempotency: accrue is safe to retry per cart.
commissionSchema.index({ cartId: 1, level: 1 }, { unique: true });
commissionSchema.index({ earnerId: 1, status: 1, createdAt: -1 });

const planSchema = new mongoose.Schema(
  {
    name: { type: String, default: 'Default Unilevel' },
    rates: { type: [Number], required: true },
    active: { type: Boolean, default: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
  },
  { timestamps: true },
);

export const CommissionModel =
  mongoose.models.Commission ?? mongoose.model('Commission', commissionSchema);
export const CommissionPlanModel =
  mongoose.models['Commission-plan'] ?? mongoose.model('Commission-plan', planSchema);

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
