import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { ProductModel } from '../src/apps/product/models/product.model.js';
import { computeProductPricing } from '../src/apps/product/domain/ProductPricing.js';
import { StarterProductModel } from '../src/modules/onboarding/infrastructure/Onboarding.models.js';
import { buildImageStore } from '../src/modules/settings/infrastructure/CloudinaryClient.js';
import { env } from '../src/shared/config/env.js';
import { MongoAuditStore } from '../src/modules/audit/infrastructure/Audit.store.js';

/**
 * Seed/update the activation starter product and the first resale product,
 * H2Os Luxe. Idempotent by SKU. Product media is uploaded to Cloudinary once;
 * reruns update copy/pricing without duplicating assets.
 */

const ROOT = path.resolve(process.cwd(), '..', 'marketspase.v2-web', 'projects', 'platform', 'public', 'img', 'products');
const STARTER_ROOT = path.resolve(process.cwd(), '..', 'marketspase.v2-web', 'projects', 'platform', 'public', 'img');
const APPLY = process.env.APPLY === '1';

const H2OS = {
  sku: 'MS-H2OS-LUXE-001',
  name: 'H2Os Luxe',
  category: 'Wellness tech',
  shortDesc: 'Portable 320ml hydrogen water bottle with dual 5/10-minute modes, OLED display and premium Tritan body.',
  desc: `H2Os Luxe is MarketSpase's flagship portable hydrogen water bottle, created for partners and customers who want a premium daily wellness product with a difference.

The 320ml bottle uses a double-sided platinum-titanium electrode and proton exchange membrane to produce hydrogen-rich water. Choose the 5-minute mode for a 4000 PPB+ session or the 10-minute mode for 8000 PPB+. The OLED touch display makes operation simple, while the pressure-relief valve, draining vent and food-grade Tritan body support safe, everyday use.

H2Os Luxe is available in a selection of premium finishes and is designed for home, office and travel. It is a genuine MarketSpase product backed by partner resale support and nationwide delivery.

Hydrogen water is a wellness product, not a medicine. This bottle is not a medical device and is not intended to diagnose, treat, cure or prevent any disease.`,
  benefits: [
    '320ml portable bottle with premium Tritan, BPA-free body',
    'Two hydrogen modes: 4000 PPB+ over 5 minutes and 8000 PPB+ over 10 minutes',
    'Double-sided platinum-titanium electrode and proton exchange membrane',
    'OLED touch display with simple one-button operation',
    'Pressure-relief valve and draining vent for safer operation',
    'Food-grade materials and easy-connect bottle design',
    'Available in a range of premium colours',
    'Genuine MarketSpase product with partner resale support',
  ],
  howToUse: 'Fill the bottle with clean drinking water. Select the 5-minute or 10-minute hydrogen mode and let the cycle finish. Drink the water fresh and follow the included care instructions for cleaning, storage and charging.',
  deliveryNote: 'Nationwide delivery. Dispatch and delivery timelines are confirmed at checkout.',
  price: 450000,
  partnerPrice: 300000,
  retailPrice: 450000,
  stock: null,
  sortOrder: 1,
  costBreakdown: {
    manufacturing: 135000,
    packaging: 8000,
    inboundFreight: 20000,
    duties: 10000,
    other: 7000,
    lastMileShipping: 7000,
    handling: 3000,
    acquisitionAllowance: 5000,
    paymentFeeRate: 0.015,
    refundReserveRate: 0.03,
    rankReserveRate: 0.015,
    notes: 'Launch planning cost for H2Os Luxe. Confirm against the actual supplier invoice before scaling.',
  },
  media: [
    { file: 'h2os-main.jpeg', type: 'image' },
    { file: 'h2os-type.jpeg', type: 'image' },
    { file: 'h2os-electronics.jpeg', type: 'image' },
    { file: 'h2os-pics.jpeg', type: 'image' },
    { file: 'h2os-video.mp4', type: 'video' },
  ],
};

const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

await mongoose.connect(uri);
const database = mongoose.connection.name;
if (!APPLY) {
  console.log(JSON.stringify({
    mode: 'dry-run (set APPLY=1 to upload media and write products)',
    database,
    starter: { sku: 'MS-STARTER-001', name: 'MarketSpase Signature Clothing Set', image: '/img/activation-hoodi.jpeg' },
    product: {
      sku: H2OS.sku,
      name: H2OS.name,
      partnerPrice: H2OS.partnerPrice,
      retailPrice: H2OS.retailPrice,
      expectedPartnerMarginPercent: 31.33,
      media: H2OS.media.map((item) => item.file),
    },
  }, null, 2));
  await mongoose.connection.close(false);
  process.exit(0);
}
const audit = new MongoAuditStore();
const admin = await mongoose.connection.db.collection('partners').findOne({ role: 'admin' });
const adminId = admin?._id ?? null;
const auditActor = adminId ? String(adminId) : 'system:admin-seed';
const now = new Date();

const store = buildImageStore({
  ...(env.cloudinary ?? {}),
  folder: process.env.CLOUDINARY_PRODUCT_FOLDER || 'marketspase-products',
  label: 'Product media',
});

const mediaTypeFor = (file) => (file.endsWith('.mp4') || file.endsWith('.webm') ? 'video' : 'image');

const uploadMedia = async (productId, media) => {
  const uploaded = [];
  try {
    for (const [index, item] of media.entries()) {
      const buffer = await fs.readFile(path.join(ROOT, item.file));
      const type = item.type ?? mediaTypeFor(item.file);
      const stored = await store.upload(buffer, {
        resourceType: type,
        publicId: `product-h2os-luxe-${productId}-${Date.now()}-${index}-${randomUUID().slice(0, 6)}`,
      });
      uploaded.push({
        type,
        url: stored.url,
        publicId: stored.publicId,
        thumbnailUrl: stored.thumbnailUrl || (type === 'image' ? stored.url : ''),
        width: stored.width ?? null,
        height: stored.height ?? null,
        duration: stored.duration ?? null,
        order: index,
      });
    }
    return uploaded;
  } catch (error) {
    await Promise.all(uploaded.map((item) => (
      item.publicId ? store.destroy(item.publicId, { resourceType: item.type }).catch(() => null) : null
    )));
    throw error;
  }
};

// ----------------------------------------------------------------- starter
const starterSource = {
  sku: 'MS-STARTER-001',
  name: 'MarketSpase Signature Clothing Set',
  description: 'A premium everyday clothing set, delivered nationwide. Activation includes business onboarding and access to the MarketSpase partner network.',
  price: 38000,
  currency: 'NGN',
  imageUrl: '/img/activation-hoodi.jpeg',
  shippingCost: 3000,
  cogs: 16000,
  active: true,
  sortOrder: 1,
};
const starterExisting = await StarterProductModel.findOne({ sku: starterSource.sku });
const starter = starterExisting
  ? await StarterProductModel.findByIdAndUpdate(
    starterExisting._id,
    { $set: { ...starterSource, imageUrl: starterSource.imageUrl } },
    { new: true },
  )
  : await StarterProductModel.create(starterSource);

if (APPLY) {
  await audit.record({
    actorId: auditActor,
    action: starterExisting ? 'product.update' : 'product.create',
    targetType: 'starter-product',
    targetId: String(starter._id),
    detail: { name: starter.name, price: starter.price, imageUrl: starter.imageUrl, source: 'seed:activation' },
  });
}

// -------------------------------------------------------------------- H2Os
const pricing = computeProductPricing({
  mode: 'both',
  price: H2OS.price,
  partnerPrice: H2OS.partnerPrice,
  retailPrice: H2OS.retailPrice,
  commissionable: true,
  mentorBonus: 0,
  costBreakdown: H2OS.costBreakdown,
});
if (!pricing.canPublish) {
  throw new Error(`H2Os pricing is not publishable: ${pricing.reasons.join('; ')}`);
}
if (pricing.partnerMarginPercent < 20) {
  throw new Error(`Partner margin is below the minimum: ${pricing.partnerMarginPercent}%`);
}

let product = await ProductModel.findOne({ sku: H2OS.sku });
const existing = Boolean(product);
if (!product) {
  product = new ProductModel({
    sku: H2OS.sku,
    name: H2OS.name,
    category: H2OS.category,
    shortDesc: H2OS.shortDesc,
    desc: H2OS.desc,
    benefits: H2OS.benefits,
    howToUse: H2OS.howToUse,
    deliveryNote: H2OS.deliveryNote,
    price: H2OS.price,
    partnerPrice: H2OS.partnerPrice,
    retailPrice: H2OS.retailPrice,
    stock: H2OS.stock,
    status: 'draft',
    commissionable: true,
    pricingMode: 'both',
    mentorBonus: 0,
    featured: true,
    sortOrder: H2OS.sortOrder,
    costBreakdown: H2OS.costBreakdown,
    cogs: pricing.landedCost,
    shippingCost: H2OS.costBreakdown.lastMileShipping,
  });
} else {
  Object.assign(product, {
    name: H2OS.name,
    category: H2OS.category,
    shortDesc: H2OS.shortDesc,
    desc: H2OS.desc,
    benefits: H2OS.benefits,
    howToUse: H2OS.howToUse,
    deliveryNote: H2OS.deliveryNote,
    price: H2OS.price,
    partnerPrice: H2OS.partnerPrice,
    retailPrice: H2OS.retailPrice,
    stock: H2OS.stock,
    commissionable: true,
    pricingMode: 'both',
    mentorBonus: 0,
    featured: true,
    sortOrder: H2OS.sortOrder,
    costBreakdown: H2OS.costBreakdown,
    cogs: pricing.landedCost,
    shippingCost: H2OS.costBreakdown.lastMileShipping,
    status: 'draft',
  });
}

if (!Array.isArray(product.media) || product.media.length === 0) {
  const uploaded = await uploadMedia(product._id, H2OS.media);
  product.media = uploaded;
}

const firstImage = product.media.find((item) => item.type === 'image')?.url ?? '';
product.img = firstImage;
product.gallery = product.media.filter((item) => item.type === 'image').map((item) => item.url);
product.pricing = { ...pricing, mode: 'both', computedAt: now };
product.publishedAt = product.publishedAt ?? now;
product.status = 'active';
await product.save();

if (APPLY) {
  await audit.record({
    actorId: auditActor,
    action: existing ? 'product.update' : 'product.create',
    targetType: 'product',
    targetId: String(product._id),
    detail: {
      name: product.name,
      sku: product.sku,
      status: product.status,
      price: product.price,
      partnerPrice: product.partnerPrice,
      retailPrice: product.retailPrice,
      partnerMargin: pricing.partnerMargin,
      partnerMarginPercent: pricing.partnerMarginPercent,
      platformContribution: pricing.platformContribution,
      platformContributionPct: pricing.platformContributionPct,
      mediaCount: product.media.length,
      source: 'seed:activation',
    },
  });
  await audit.record({
    actorId: auditActor,
    action: 'product.publish',
    targetType: 'product',
    targetId: String(product._id),
    detail: { name: product.name, pricingStatus: pricing.status, platformContribution: pricing.platformContribution },
  });
}

console.log(JSON.stringify({
  database,
  admin: auditActor,
  starter: {
    id: String(starter._id),
    sku: starter.sku,
    name: starter.name,
    price: starter.price,
    imageUrl: starter.imageUrl,
    active: starter.active,
  },
  product: {
    id: String(product._id),
    sku: product.sku,
    name: product.name,
    status: product.status,
    price: product.price,
    partnerPrice: product.partnerPrice,
    retailPrice: product.retailPrice,
    pricingMode: product.pricingMode,
    mediaCount: product.media.length,
    media: product.media.map((item) => ({ type: item.type, url: item.url, order: item.order })),
    pricing: {
      status: pricing.status,
      landedCost: pricing.landedCost,
      totalCostPerUnit: pricing.totalCostPerUnit,
      partnerMargin: pricing.partnerMargin,
      partnerMarginPercent: pricing.partnerMarginPercent,
      platformContribution: pricing.platformContribution,
      platformContributionPct: pricing.platformContributionPct,
    },
  },
}, null, 2));

await mongoose.connection.close(false);
