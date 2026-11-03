import mongoose from 'mongoose';

const starterProductSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'NGN', trim: true },
    shippingCost: { type: Number, default: 0, min: 0 },
    cogs: { type: Number, default: 0, min: 0 },
    imageUrl: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'starter_products' },
);

const activationOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, trim: true },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StarterProduct',
      required: true,
    },
    productName: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'NGN', trim: true },
    cogs: { type: Number, default: 0, min: 0 },
    shippingCost: { type: Number, default: 0, min: 0 },
    paymentFee: { type: Number, default: 0, min: 0 },
    grossMargin: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['Paid', 'Fulfilled', 'Refunded', 'Cancelled'],
      default: 'Paid',
      index: true,
    },
    shipping: {
      fullName: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      street: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
      country: { type: String, default: 'Nigeria', trim: true },
      notes: { type: String, default: '', trim: true },
    },
    paymentMethod: { type: String, default: 'Wallet', trim: true },
    paymentReference: { type: String, required: true, trim: true },
    idempotencyKey: { type: String, default: undefined, trim: true },
    activatedAt: { type: Date, required: true },
    fulfilledAt: { type: Date, default: null },
    fulfilledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    refundedAt: { type: Date, default: null },
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    refundReason: { type: String, default: null, trim: true },
    adminNote: { type: String, default: null, trim: true },
  },
  { timestamps: true, collection: 'activation_orders' },
);

const activationQueueEntrySchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ['queued', 'allocated', 'cancelled'],
      default: 'queued',
      index: true,
    },
    enteredAt: { type: Date, default: Date.now, index: true },
    allocatedAt: { type: Date, default: null },
    campaignId: { type: mongoose.Schema.Types.ObjectId, default: null },
    placementParentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      default: null,
    },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'activation_queue' },
);

const kycSubmissionSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      unique: true,
    },
    dateOfBirth: { type: Date, required: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    country: { type: String, default: 'Nigeria', trim: true },
    idType: {
      type: String,
      enum: ['nin', 'drivers_license', 'passport', 'voters_card'],
      required: true,
    },
    idNumberHash: {
      type: String,
      required: true,
      select: false,
    },
    idLast4: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      index: true,
    },
    submittedAt: { type: Date, default: Date.now },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: null, trim: true },
  },
  { timestamps: true, collection: 'kyc_submissions' },
);

activationOrderSchema.index({ partnerId: 1, createdAt: -1 });
activationOrderSchema.index({ status: 1, createdAt: 1 });
activationOrderSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    sparse: true,
    name: 'idempotencyKey_sparse_1',
  },
);
activationQueueEntrySchema.index({ status: 1, enteredAt: 1 });
kycSubmissionSchema.index({ status: 1, submittedAt: 1 });

export const StarterProductModel =
  mongoose.models.StarterProduct
  || mongoose.model('StarterProduct', starterProductSchema);

export const ActivationOrderModel =
  mongoose.models.ActivationOrder
  || mongoose.model('ActivationOrder', activationOrderSchema);

export const ActivationQueueEntryModel =
  mongoose.models.ActivationQueueEntry
  || mongoose.model('ActivationQueueEntry', activationQueueEntrySchema);

export const KycSubmissionModel =
  mongoose.models.KycSubmission
  || mongoose.model('KycSubmission', kycSubmissionSchema);
