import mongoose from 'mongoose';

const socialSchema = {
  instagram: { type: String, default: '', trim: true },
  tiktok: { type: String, default: '', trim: true },
  facebook: { type: String, default: '', trim: true },
  x: { type: String, default: '', trim: true },
  youtube: { type: String, default: '', trim: true },
};

const storeSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      unique: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, default: '', trim: true },
    tagline: { type: String, default: '', trim: true },
    bio: { type: String, default: '', trim: true },
    logo: { type: String, default: '', trim: true },
    banner: { type: String, default: '', trim: true },
    whatsapp: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    ...socialSchema,
    deliveryNote: { type: String, default: '', trim: true },
    deliveryFee: { type: Number, min: 0, default: 0 },
    returnPolicy: { type: String, default: '', trim: true },
    autoPublish: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['draft', 'published', 'suspended'],
      default: 'draft',
      index: true,
    },
    /**
     * Denormalised count of published listings with stock > 0. Kept current
     * by the store repositories so the directory can filter cheaply.
     */
    inStockCount: { type: Number, min: 0, default: 0, index: true },
    suspendedAt: { type: Date, default: null },
    suspensionReason: { type: String, default: '', trim: true },
  },
  { timestamps: true, collection: 'stores' },
);

const storeProductSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    image: { type: String, default: '', trim: true },
    images: { type: [String], default: [] },
    category: { type: String, default: 'Essentials', trim: true },
    shortDesc: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    retailPrice: { type: Number, min: 0, default: 0 },
    stock: { type: Number, min: 0, default: 0 },
    soldCount: { type: Number, min: 0, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'published', 'paused'],
      default: 'draft',
      index: true,
    },
  },
  { timestamps: true, collection: 'store_products' },
);

const storeInventorySchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    quantity: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true, collection: 'store_inventory' },
);

const storeStockLedgerSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    quantity: { type: Number, required: true },
    type: {
      type: String,
      enum: ['wholesale_receipt', 'store_sale', 'store_cancel', 'adjustment'],
      required: true,
      index: true,
    },
    reference: { type: String, default: '', trim: true },
    note: { type: String, default: '', trim: true },
  },
  { timestamps: true, collection: 'store_stock_ledger' },
);

const storeOrderItemSchema = new mongoose.Schema(
  {
    storeProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StoreProduct',
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    image: { type: String, default: '', trim: true },
    category: { type: String, default: 'Essentials', trim: true },
    unitPriceKobo: { type: Number, min: 0, required: true },
    quantity: { type: Number, min: 1, required: true },
    lineTotalKobo: { type: Number, min: 0, required: true },
  },
  { _id: false },
);

const storeCustomerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    phoneKey: { type: String, default: '', trim: true, index: true },
    street: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    country: { type: String, default: 'Nigeria', trim: true },
    note: { type: String, default: '', trim: true },
    consentToContact: { type: Boolean, default: false },
  },
  { _id: false },
);

const storeOrderEventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    at: { type: Date, default: Date.now },
    note: { type: String, default: '', trim: true },
  },
  { _id: false },
);

const storeOrderSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    orderNumber: { type: String, required: true, unique: true, index: true },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    storeSlug: { type: String, required: true, trim: true },
    storeName: { type: String, required: true, trim: true },
    customer: { type: storeCustomerSchema, required: true },
    items: { type: [storeOrderItemSchema], default: [] },
    amounts: {
      merchandiseKobo: { type: Number, min: 0, default: 0 },
      deliveryKobo: { type: Number, min: 0, default: 0 },
      totalKobo: { type: Number, min: 0, default: 0 },
      serviceFeeKobo: { type: Number, min: 0, default: 0 },
      serviceFeePercent: { type: Number, min: 0, default: 0 },
      paymentFeeKobo: { type: Number, min: 0, default: 0 },
      partnerPendingKobo: { type: Number, min: 0, default: 0 },
    },
    payment: {
      provider: { type: String, default: 'paystack', trim: true },
      status: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending',
        index: true,
      },
      reference: { type: String, default: '', trim: true, index: true },
      authorizationUrl: { type: String, default: '', trim: true },
      accessCode: { type: String, default: '', trim: true },
      paidAt: { type: Date, default: null },
      channel: { type: String, default: '', trim: true },
      currency: { type: String, default: 'NGN', trim: true },
      gatewayResponse: { type: String, default: '', trim: true },
    },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
      default: 'pending_payment',
      index: true,
    },
    stockReserved: { type: Boolean, default: false },
    stockReleased: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null, index: true },
    paidAt: { type: Date, default: null },
    processingAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundReference: { type: String, default: '', trim: true },
    refundReason: { type: String, default: '', trim: true },
    settledAt: { type: Date, default: null },
    escrow: {
      status: {
        type: String,
        enum: ['none', 'held', 'released', 'refunded'],
        default: 'none',
        index: true,
      },
      releaseAt: { type: Date, default: null },
      releasedAt: { type: Date, default: null },
    },
    fulfilment: {
      courier: { type: String, default: '', trim: true },
      trackingNumber: { type: String, default: '', trim: true },
      trackingUrl: { type: String, default: '', trim: true },
      note: { type: String, default: '', trim: true },
    },
    events: { type: [storeOrderEventSchema], default: [] },
  },
  { timestamps: true, collection: 'store_orders' },
);

/**
 * Store customer lead — one row per partner + normalized phone.
 * Created when a shopper reaches checkout, then enriched when payment is
 * confirmed. This is the partner's CRM view of store buyers, separate from
 * the prospect pipeline (which is for non-buying leads).
 */
const storeCustomerLeadSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
    phoneKey: { type: String, required: true, trim: true, index: true },
    name: { type: String, default: '', trim: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    phone: { type: String, default: '', trim: true },
    street: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    country: { type: String, default: 'Nigeria', trim: true },
    note: { type: String, default: '', trim: true },
    consentToContact: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['New', 'Contacted', 'Qualified', 'Converted', 'Closed'],
      default: 'New',
      index: true,
    },
    partnerNotes: { type: String, default: '', trim: true, maxlength: 2000 },
    tags: { type: [String], default: [] },
    checkoutCount: { type: Number, default: 0, min: 0 },
    paidOrders: { type: Number, default: 0, min: 0 },
    refundedOrders: { type: Number, default: 0, min: 0 },
    totalSpentKobo: { type: Number, default: 0, min: 0 },
    firstSeenAt: { type: Date, default: Date.now },
    lastCheckoutAt: { type: Date, default: Date.now },
    lastPaidAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'store_customer_leads' },
);

storeCustomerLeadSchema.index({ partnerId: 1, phoneKey: 1 }, { unique: true });
storeCustomerLeadSchema.index({ partnerId: 1, lastCheckoutAt: -1 });
storeCustomerLeadSchema.index({ partnerId: 1, status: 1, lastCheckoutAt: -1 });

const storeEscrowLedgerSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StoreOrder',
      required: true,
      index: true,
    },
    reference: { type: String, required: true, trim: true, index: true },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['customer_payment', 'service_fee', 'payment_fee', 'partner_pending', 'partner_release', 'refund'],
      required: true,
    },
    amountKobo: { type: Number, required: true },
    status: {
      type: String,
      enum: ['posted', 'released', 'void'],
      default: 'posted',
    },
    note: { type: String, default: '', trim: true },
  },
  { timestamps: true, collection: 'store_escrow_ledger' },
);

const storeReturnRequestSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreOrder', required: true, unique: true, index: true },
    reference: { type: String, required: true, trim: true, index: true },
    orderNumber: { type: String, required: true, trim: true },
    customerEmail: { type: String, default: '', lowercase: true, trim: true },
    items: {
      type: [{
        storeProductId: { type: mongoose.Schema.Types.ObjectId, required: true },
        name: { type: String, default: '', trim: true },
        quantity: { type: Number, min: 1, required: true },
      }],
      _id: false,
    },
    reason: { type: String, required: true, trim: true, maxlength: 160 },
    note: { type: String, default: '', trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled'],
      default: 'requested',
      index: true,
    },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    receivedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundReference: { type: String, default: '', trim: true },
    adminNote: { type: String, default: '', trim: true, maxlength: 1000 },
  },
  { timestamps: true, collection: 'store_return_requests' },
);

const platformSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, default: 'store' },
    storeServiceFeePercent: { type: Number, min: 0, max: 20, default: 2 },
    storeEscrowHoldDays: { type: Number, min: 0, max: 60, default: 7 },
    storeAutoDeliverDays: { type: Number, min: 0, max: 60, default: 10 },
    storeReturnWindowDays: { type: Number, min: 0, max: 60, default: 7 },
  },
  { timestamps: true, collection: 'platform_settings' },
);

storeProductSchema.index({ storeId: 1, productId: 1 }, { unique: true });
storeProductSchema.index({ storeId: 1, status: 1, createdAt: -1 });
storeInventorySchema.index({ partnerId: 1, productId: 1 }, { unique: true });
storeStockLedgerSchema.index({ partnerId: 1, createdAt: -1 });
platformSettingSchema.index({ key: 1 }, { unique: true });
storeOrderSchema.index({ partnerId: 1, createdAt: -1 });
storeOrderSchema.index({ storeId: 1, createdAt: -1 });
storeOrderSchema.index({ status: 1, expiresAt: 1 });
storeOrderSchema.index({ status: 1, 'escrow.status': 1, 'escrow.releaseAt': 1 });
storeEscrowLedgerSchema.index({ orderId: 1, type: 1 }, { unique: true });
storeEscrowLedgerSchema.index({ partnerId: 1, createdAt: -1 });

export const StoreModel = mongoose.models.Store || mongoose.model('Store', storeSchema);
export const StoreProductModel =
  mongoose.models.StoreProduct || mongoose.model('StoreProduct', storeProductSchema);
export const StoreInventoryModel =
  mongoose.models.StoreInventory || mongoose.model('StoreInventory', storeInventorySchema);
export const StoreStockLedgerModel =
  mongoose.models.StoreStockLedger || mongoose.model('StoreStockLedger', storeStockLedgerSchema);
export const StoreOrderModel =
  mongoose.models.StoreOrder || mongoose.model('StoreOrder', storeOrderSchema);
export const StoreReturnRequestModel =
  mongoose.models.StoreReturnRequest || mongoose.model('StoreReturnRequest', storeReturnRequestSchema);
export const StoreCustomerLeadModel =
  mongoose.models.StoreCustomerLead || mongoose.model('StoreCustomerLead', storeCustomerLeadSchema);
export const StoreEscrowLedgerModel =
  mongoose.models.StoreEscrowLedger || mongoose.model('StoreEscrowLedger', storeEscrowLedgerSchema);
export const PlatformSettingModel =
  mongoose.models.PlatformSetting || mongoose.model('PlatformSetting', platformSettingSchema);
