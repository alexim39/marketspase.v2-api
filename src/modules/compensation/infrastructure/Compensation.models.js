import mongoose from 'mongoose';

const commissionSaleSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivationOrder', required: true, unique: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
    orderNumber: { type: String, default: '', trim: true },
    productName: { type: String, default: '', trim: true },
    grossMargin: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending_placement', 'accrued', 'cancelled'],
      default: 'pending_placement',
      index: true,
    },
    placementParentId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    activatedAt: { type: Date, required: true },
    accruedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null, trim: true },
  },
  { timestamps: true, collection: 'commission_sales' },
);

const growthCommissionSchema = new mongoose.Schema(
  {
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommissionSale', required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivationOrder', required: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
    earnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
    saleType: { type: String, enum: ['activation', 'product'], default: 'activation', index: true },
    level: { type: Number, required: true, min: 1, max: 5 },
    rate: { type: Number, required: true, min: 0, max: 1 },
    amount: { type: Number, required: true, min: 0 },
    grossMargin: { type: Number, required: true, min: 0 },
    rankAtAccrual: {
      type: String,
      enum: ['Partner', 'Builder', 'Leader', 'Ambassador'],
      default: 'Partner',
    },
    status: {
      type: String,
      enum: ['Pending', 'Released', 'Voided', 'Reversed'],
      default: 'Pending',
      index: true,
    },
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    releasedAt: { type: Date, default: null },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    voidedAt: { type: Date, default: null },
    reversalReason: { type: String, default: null, trim: true },
    recoveredAmount: { type: Number, default: 0, min: 0 },
    outstandingAmount: { type: Number, default: 0, min: 0 },
    transactionReference: { type: String, default: null, trim: true },
  },
  { timestamps: true, collection: 'growth_commissions' },
);

/**
 * Snapshot of the product-order margin used for one product commission run.
 * Kept separate from activation `commission_sales` so mentor bonuses and
 * activation placement never mix with retail orders.
 */
const productCommissionSaleSchema = new mongoose.Schema(
  {
    cartId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cart', required: true, unique: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
    orderNumber: { type: String, default: '', trim: true },
    totalCost: { type: Number, default: 0, min: 0 },
    grossMargin: { type: Number, required: true, min: 0 },
    commissionableMargin: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['accrued', 'released', 'voided'],
      default: 'accrued',
      index: true,
    },
    accruedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    voidReason: { type: String, default: null, trim: true },
  },
  { timestamps: true, collection: 'product_commission_sales' },
);

const mentorBonusSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivationOrder', required: true, unique: true },
    activationPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
    mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null, index: true },
    amount: { type: Number, required: true, min: 0 },
    dueAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['scheduled', 'paid', 'forfeited', 'cancelled', 'clawed_back'],
      default: 'scheduled',
      index: true,
    },
    paidAt: { type: Date, default: null },
    transactionReference: { type: String, default: null, trim: true },
    note: { type: String, default: null, trim: true },
    recoveredAmount: { type: Number, default: 0, min: 0 },
    outstandingAmount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: 'mentor_bonuses' },
);

commissionSaleSchema.index({ status: 1, activatedAt: 1 });
productCommissionSaleSchema.index({ status: 1, createdAt: 1 });
growthCommissionSchema.index({ saleId: 1, level: 1 }, { unique: true });
growthCommissionSchema.index({ earnerId: 1, status: 1, createdAt: -1 });
growthCommissionSchema.index({ status: 1, createdAt: 1 });
growthCommissionSchema.index({ saleType: 1, createdAt: -1 });
mentorBonusSchema.index({ status: 1, dueAt: 1 });
mentorBonusSchema.index({ mentorId: 1, status: 1, createdAt: -1 });

export const CommissionSaleModel =
  mongoose.models.CommissionSale
  || mongoose.model('CommissionSale', commissionSaleSchema);

export const ProductCommissionSaleModel =
  mongoose.models.ProductCommissionSale
  || mongoose.model('ProductCommissionSale', productCommissionSaleSchema);

export const GrowthCommissionModel =
  mongoose.models.GrowthCommission
  || mongoose.model('GrowthCommission', growthCommissionSchema);

export const MentorBonusModel =
  mongoose.models.MentorBonus
  || mongoose.model('MentorBonus', mentorBonusSchema);
