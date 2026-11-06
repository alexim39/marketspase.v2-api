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
    returnPolicy: { type: String, default: '', trim: true },
    autoPublish: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['draft', 'published', 'suspended'],
      default: 'draft',
      index: true,
    },
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

storeProductSchema.index({ storeId: 1, productId: 1 }, { unique: true });
storeProductSchema.index({ storeId: 1, status: 1, createdAt: -1 });
storeInventorySchema.index({ partnerId: 1, productId: 1 }, { unique: true });
storeStockLedgerSchema.index({ partnerId: 1, createdAt: -1 });

export const StoreModel = mongoose.models.Store || mongoose.model('Store', storeSchema);
export const StoreProductModel =
  mongoose.models.StoreProduct || mongoose.model('StoreProduct', storeProductSchema);
export const StoreInventoryModel =
  mongoose.models.StoreInventory || mongoose.model('StoreInventory', storeInventorySchema);
export const StoreStockLedgerModel =
  mongoose.models.StoreStockLedger || mongoose.model('StoreStockLedger', storeStockLedgerSchema);
