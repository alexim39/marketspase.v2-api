import { ProductModel, CartModel} from '../models/product.model.js';
import { randomUUID } from 'node:crypto';
import { sendEmail } from "../../../services/emailService.js";
import {TransactionModel} from '../../transaction/models/transaction.model.js';
import { PartnersModel } from '../../partner/models/partner.model.js';
import { NotifyUseCase } from '../../../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { recordAudit } from '../../../modules/audit/index.js';
import { MongoCompensationRepository } from '../../../modules/compensation/infrastructure/Compensation.mongo.repository.js';
import {
  AccrueProductCommissionsUseCase,
  ReleaseProductCommissionsUseCase,
  VoidProductCommissionsUseCase,
} from '../../../modules/compensation/application/ProductCommission.usecases.js';
import { summarizeProductMargins } from '../../../modules/compensation/domain/ProductCommission.js';
import { runInTransaction } from '../../../modules/identity-access/infrastructure/Auth.models.js';
import { AppError } from '../../../shared/domain/AppError.js';
import mongoose from 'mongoose';
import { SearchMissModel } from '../../../modules/search/infrastructure/SearchMiss.mongo.model.js';
import { cleanShipping } from '../domain/Shipping.js';
import { canBuyResale, cartSaleMode, resalePrices } from '../domain/Resale.js';
import { aggregateStockRequirements, isStockTracked } from '../domain/Stock.js';
import {
  computeProductPricing,
  normalizePricingMode,
  validatePublishPricing,
} from '../domain/ProductPricing.js';
import { buildImageStore } from '../../../modules/settings/infrastructure/CloudinaryClient.js';
import { env } from '../../../shared/config/env.js';

const productCommissionPlan = () => (
  process.env.PRODUCT_COMMISSION_PLAN === 'legacy' ? 'legacy' : 'growth'
);

const productOrderNumber = () => (
  `PRD-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`
);

const productCommissionRepo = () => new MongoCompensationRepository();

// Admin queue: every order by status, oldest first (money already debited).
export const listOrdersForAdmin = async (req, res) => {
  try {
    const status = req.query.status ?? 'Pending';
    if (!['Pending', 'Fulfilled', 'Cancelled'].includes(status) && status !== 'All') {
      return res.status(400).json({ message: 'Invalid status filter', success: false });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const filter = status === 'All' ? {} : { orderStatus: status };
    const [rows, total] = await Promise.all([
      CartModel.find(filter)
        .populate('products.product', 'name price')
        .sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
      CartModel.countDocuments(filter),
    ]);
    const ownerIds = [...new Set(rows.map((r) => String(r.partner)).filter(Boolean))];
    const owners = ownerIds.length > 0
      ? await PartnersModel.find({ _id: { $in: ownerIds } }).select('username name surname phone').lean().catch(() => [])
      : [];
    const labels = Object.fromEntries((owners ?? []).map((o) => [String(o._id), {
      username: o.username,
      name: [o.name, o.surname].filter(Boolean).join(' ') || o.username,
      phone: o.phone ?? null,
    }]));
    res.status(200).json({
      message: 'Orders retrieved successfully!',
      data: rows.map((r) => ({ ...r, owner: labels[String(r.partner)] ?? null })),
      meta: { total, limit, skip },
      success: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving orders', error: error.message, success: false });
  }
};

/** Best-effort owner notice — never fails the decision. */
const notifyBuyer = async (ownerId, { title, body, orderId, status }) => {
  try {
    const stored = new MongoStoredNotificationStore();
    await new NotifyUseCase({ stored }).execute({
      recipientId: String(ownerId),
      category: 'commission',
      priority: 'medium',
      title,
      body,
      icon: 'shopping_bag',
      link: '/dashboard/products/order-history',
      key: `order:${orderId}:${status}`,
    }).catch(() => null);
  } catch { /* notifications never fail admin actions */ }
};

// Admin decision: Pending→Fulfilled (ship it) or →Cancelled (full refund —
export const decideOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body ?? {};
    if (!['Fulfilled', 'Cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status', success: false });
    }

    const existing = await CartModel.findById(id).select('orderStatus').lean();
    if (!existing) {
      return res.status(404).json({ message: 'Order not found', success: false });
    }
    if ((existing.orderStatus ?? 'Pending') !== 'Pending') {
      return res.status(409).json({ message: `Cannot decide a ${existing.orderStatus} order`, success: false });
    }

    const now = new Date();
    const updated = await runInTransaction(async (session) => {
      const opts = session ? { session } : {};
      const claimed = await CartModel.findOneAndUpdate(
        {
          _id: id,
          $or: [
            { orderStatus: 'Pending' },
            { orderStatus: { $exists: false } },
            { orderStatus: null },
          ],
        },
        {
          $set: {
            orderStatus: status,
            decidedAt: now,
            ...(status === 'Fulfilled' ? { fulfilledAt: now } : { cancelledAt: now }),
          },
        },
        { new: true, ...opts },
      ).lean();
      if (!claimed) {
        throw new AppError('Order was already decided', 409, 'ORDER_ALREADY_DECIDED');
      }

      if (status === 'Cancelled') {
        if (Number(claimed.totalCost) > 0) {
          const owner = await PartnersModel.findByIdAndUpdate(
            claimed.partner,
            { $inc: { balance: Number(claimed.totalCost) } },
            { new: true, ...opts },
          ).lean();
          if (!owner) {
            throw new AppError('Order buyer not found', 404, 'NOT_FOUND');
          }
          await TransactionModel.create(
            [{
              partnerId: claimed.partner,
              amount: Number(claimed.totalCost),
              balanceBefore: Number(owner.balance ?? 0) - Number(claimed.totalCost),
              balanceAfter: owner.balance ?? null,
              status: 'Completed',
              paymentMethod: 'Order Refund',
              transactionType: 'Credit',
              reference: `REF-${claimed.orderNumber || String(claimed._id).slice(-6)}-${Date.now().toString(36)}`,
              date: now,
            }],
            opts,
          );
        }

        if (!claimed.stockRestored) {
          for (const item of claimed.products ?? []) {
            if (!item.stockTracked) continue;
            const quantity = Number(item.quantity) || 0;
            if (quantity <= 0) continue;
            await ProductModel.updateOne(
              { _id: item.product, stock: { $type: 'number' } },
              { $inc: { stock: quantity } },
              opts,
            );
          }
          await CartModel.updateOne(
            { _id: claimed._id },
            { $set: { stockRestored: true, stockRestoredAt: now } },
            opts,
          );
          claimed.stockRestored = true;
          claimed.stockRestoredAt = now;
        }
      }

      return claimed;
    });

    // Product commissions: growth carts accrue on the product margin and
    // release only after fulfilment. Legacy carts keep their old flow.
    let commission = null;
    if (updated.commissionPlan === 'growth') {
      const repo = productCommissionRepo();
      try {
        if (status === 'Fulfilled') {
          await new AccrueProductCommissionsUseCase({ repo }).execute(updated._id);
          commission = await new ReleaseProductCommissionsUseCase({ repo })
            .execute(updated._id, req.auth?.partnerId);
        } else {
          commission = await new VoidProductCommissionsUseCase({ repo })
            .execute(updated._id, req.auth?.partnerId, 'Product order cancelled');
        }
      } catch (commissionError) {
        console.error('Product commission update failed:', commissionError?.message ?? commissionError);
        commission = { error: true };
      }
    }

    await notifyBuyer(updated.partner, {
      title: status === 'Fulfilled' ? 'Your order is on its way' : 'Your order was cancelled',
      body: status === 'Fulfilled'
        ? `Order worth ₦${Number(updated.totalCost).toLocaleString()} has been fulfilled.`
        : `Your order was cancelled and ₦${Number(updated.totalCost).toLocaleString()} was refunded in full.`,
      orderId: String(updated._id),
      status,
    });

    res.status(200).json({ message: `Order marked as ${status.toLowerCase()}!`, data: updated, commission, success: true });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'order.decide',
      targetType: 'order', targetId: String(updated._id),
      detail: {
        status,
        amount: Number(updated.totalCost) ?? null,
        owner: String(updated.partner),
        stockRestored: !!updated.stockRestored,
        commission: commission ? { released: commission.released ?? 0, voided: commission.voided ?? 0, error: !!commission.error } : null,
      },
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        success: false,
      });
    }
    res.status(500).json({ message: 'Error deciding order', error: error.message, success: false });
  }
};

const cleanText = (value, max) => String(value ?? '').trim().slice(0, max);
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanNumber = (value, label, { min = 0, allowNull = false } = {}) => {
  if (allowNull && (value === null || value === '')) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) {
    throw new Error(`${label} must be ${min} or more`);
  }
  return Math.round(number * 100) / 100;
};

const cleanStringList = (value, { maxItems = 8, maxLength = 300 } = {}) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
};

const cleanRate = (value, label, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
  return Math.round(number * 10000) / 10000;
};

const safeMediaUrl = (value, label) => {
  const url = cleanText(value, 1000);
  if (!url) throw new Error(`${label} is required`);
  if (!/^(https?:\/\/|\/)/i.test(url)) {
    throw new Error(`${label} must be an http(s) URL or a path starting with /`);
  }
  return url;
};

const cleanMediaList = (value) => {
  if (!Array.isArray(value)) throw new Error('Media must be a list');
  if (value.length > 5) throw new Error('A product can have at most 5 media items');
  return value.map((item, index) => {
    const raw = typeof item === 'string' ? { type: 'image', url: item } : (item ?? {});
    const type = raw.type === 'video' ? 'video' : 'image';
    const url = safeMediaUrl(raw.url, 'Media URL');
    const thumbnailUrl = raw.thumbnailUrl ? safeMediaUrl(raw.thumbnailUrl, 'Media thumbnail') : '';
    return {
      type,
      url,
      thumbnailUrl: thumbnailUrl || (type === 'video' ? '' : url),
      publicId: raw.publicId ? cleanText(raw.publicId, 300) : null,
      width: raw.width === null || raw.width === undefined ? null : cleanNumber(raw.width, 'Media width'),
      height: raw.height === null || raw.height === undefined ? null : cleanNumber(raw.height, 'Media height'),
      duration: raw.duration === null || raw.duration === undefined ? null : cleanNumber(raw.duration, 'Media duration'),
      order: index,
    };
  });
};

const cleanCostBreakdown = (value) => {
  if (!value || typeof value !== 'object') return null;
  const field = (key, label) => cleanNumber(value[key] ?? 0, label);
  const manufacturing = field('manufacturing', 'Manufacturing cost');
  const packaging = field('packaging', 'Packaging cost');
  const inboundFreight = field('inboundFreight', 'Inbound freight');
  const duties = field('duties', 'Duties and tariffs');
  const other = field('other', 'Other landed cost');
  const lastMileShipping = field('lastMileShipping', 'Last-mile delivery');
  const handling = field('handling', 'Handling and fulfilment');
  const acquisitionAllowance = field('acquisitionAllowance', 'Acquisition allowance');
  const paymentFeeRate = Math.max(cleanRate(value.paymentFeeRate, 'Payment fee rate', 0.015), 0.015);
  const refundReserveRate = Math.max(cleanRate(value.refundReserveRate, 'Refund reserve rate', 0.03), 0.03);
  const rankReserveRate = Math.max(cleanRate(value.rankReserveRate, 'Rank reserve rate', 0.015), 0.015);
  return {
    manufacturing,
    packaging,
    inboundFreight,
    duties,
    other,
    lastMileShipping,
    handling,
    acquisitionAllowance,
    paymentFeeRate,
    refundReserveRate,
    rankReserveRate,
    notes: cleanText(value.notes, 1000),
    landedCost: Math.round((manufacturing + packaging + inboundFreight + duties + other) * 100) / 100,
    totalCostPerUnit: Math.round((
      manufacturing
      + packaging
      + inboundFreight
      + duties
      + other
      + lastMileShipping
      + handling
      + acquisitionAllowance
    ) * 100) / 100,
  };
};

const mediaToLegacyFields = (media = []) => {
  const images = media.filter((item) => item.type === 'image').map((item) => item.url);
  const first = media[0];
  const cover = first
    ? (first.type === 'video' ? (first.thumbnailUrl || '') : first.url)
    : '';
  return {
    img: cover || images[0] || '',
    gallery: images,
  };
};

const pricingOverrides = (body = {}) => {
  const out = {};
  if (body.targetPlatformContributionPct !== undefined) {
    out.targetPlatformContributionPct = cleanRate(body.targetPlatformContributionPct, 'Target platform contribution');
  }
  if (body.targetPartnerMarginPct !== undefined) {
    out.targetPartnerMarginPct = cleanRate(body.targetPartnerMarginPct, 'Target partner margin');
  }
  return out;
};

const buildPricingSnapshot = (fields = {}) => computeProductPricing({
  mode: fields.pricingMode,
  price: fields.price,
  partnerPrice: fields.partnerPrice,
  retailPrice: fields.retailPrice,
  commissionable: fields.commissionable,
  mentorBonus: fields.mentorBonus,
  costBreakdown: fields.costBreakdown,
  policy: {
    ...pricingOverrides(fields),
    ...(fields.costBreakdown?.paymentFeeRate !== undefined ? { paymentFeeRate: fields.costBreakdown.paymentFeeRate } : {}),
    ...(fields.costBreakdown?.refundReserveRate !== undefined ? { refundReserveRate: fields.costBreakdown.refundReserveRate } : {}),
    ...(fields.costBreakdown?.rankReserveRate !== undefined ? { rankReserveRate: fields.costBreakdown.rankReserveRate } : {}),
  },
});

const mediaForProduct = (product = {}) => {
  if (Array.isArray(product.media) && product.media.length > 0) return product.media;
  const legacy = [product.img, ...(product.gallery ?? [])].map((url) => cleanText(url, 1000)).filter(Boolean);
  return [...new Set(legacy)].slice(0, 5).map((url, index) => ({
    type: 'image',
    url,
    publicId: null,
    thumbnailUrl: url,
    width: null,
    height: null,
    duration: null,
    order: index,
  }));
};

const PUBLIC_HIDDEN_FIELDS = [
  'cogs',
  'shippingCost',
  'partnerPrice',
  'retailPrice',
  'commissionable',
  'costBreakdown',
  'pricing',
  'mentorBonus',
];

const toPublicProduct = (product, { includeResale = false } = {}) => {
  if (!product) return product;
  const media = Array.isArray(product.media)
    ? product.media.map(({ publicId, ...item }) => item)
    : [];
  const result = {
    ...product,
    media,
    resaleEnabled: product.pricingMode !== 'direct' && Number(product.partnerPrice) > 0,
  };
  for (const field of PUBLIC_HIDDEN_FIELDS) {
    if (includeResale && (field === 'partnerPrice' || field === 'retailPrice')) continue;
    delete result[field];
  }
  return result;
};

const cleanProductFields = (body = {}) => {
  const out = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name, 200);
    if (!name) throw new Error('Product name is required');
    out.name = name;
  }
  if (body.price !== undefined) {
    out.price = cleanNumber(body.price, 'Product price');
  }
  if (body.sku !== undefined) out.sku = cleanText(body.sku, 64);
  if (body.desc !== undefined) out.desc = String(body.desc).slice(0, 8000);
  if (body.img !== undefined) out.img = cleanText(body.img, 500);
  if (body.gallery !== undefined) out.gallery = cleanStringList(body.gallery, { maxItems: 8, maxLength: 500 });
  if (body.category !== undefined) out.category = cleanText(body.category, 80) || 'Essentials';
  if (body.shortDesc !== undefined) out.shortDesc = cleanText(body.shortDesc, 240);
  if (body.benefits !== undefined) out.benefits = cleanStringList(body.benefits, { maxItems: 8, maxLength: 200 });
  if (body.howToUse !== undefined) out.howToUse = cleanText(body.howToUse, 1200);
  if (body.deliveryNote !== undefined) out.deliveryNote = cleanText(body.deliveryNote, 1200);
  if (body.cogs !== undefined) out.cogs = cleanNumber(body.cogs, 'Cost price');
  if (body.shippingCost !== undefined) out.shippingCost = cleanNumber(body.shippingCost, 'Shipping cost');
  if (body.partnerPrice !== undefined) out.partnerPrice = cleanNumber(body.partnerPrice, 'Partner price');
  if (body.retailPrice !== undefined) out.retailPrice = cleanNumber(body.retailPrice, 'Retail price');
  if (body.stock !== undefined) {
    out.stock = body.stock === null ? null : cleanNumber(body.stock, 'Stock');
  }
  if (body.status !== undefined) {
    if (!['draft', 'active', 'inactive', 'archived'].includes(body.status)) {
      throw new Error('Product status must be draft, active, inactive or archived');
    }
    out.status = body.status;
  }
  if (body.commissionable !== undefined) out.commissionable = Boolean(body.commissionable);
  if (body.pricingMode !== undefined) out.pricingMode = normalizePricingMode(body.pricingMode);
  if (body.mentorBonus !== undefined) out.mentorBonus = cleanNumber(body.mentorBonus, 'Mentor bonus');
  if (body.targetPlatformContributionPct !== undefined) {
    out.targetPlatformContributionPct = cleanRate(body.targetPlatformContributionPct, 'Target platform contribution');
  }
  if (body.targetPartnerMarginPct !== undefined) {
    out.targetPartnerMarginPct = cleanRate(body.targetPartnerMarginPct, 'Target partner margin');
  }
  if (body.costBreakdown !== undefined) {
    const breakdown = cleanCostBreakdown(body.costBreakdown);
    if (breakdown) {
      out.costBreakdown = breakdown;
      out.cogs = breakdown.landedCost;
      out.shippingCost = breakdown.lastMileShipping;
    }
  }
  if (body.media !== undefined) {
    const media = cleanMediaList(body.media);
    out.media = media;
    Object.assign(out, mediaToLegacyFields(media));
  } else if (body.img !== undefined || body.gallery !== undefined) {
    // Legacy URL-only editors still work: convert their images into media so
    // the new galleries and the old fields stay coherent.
    const legacyImages = [body.img, ...(body.gallery ?? [])]
      .map((url) => cleanText(url, 1000))
      .filter(Boolean)
      .slice(0, 5);
    if (legacyImages.length > 0) {
      const media = legacyImages.map((url, index) => ({
        type: 'image',
        url,
        thumbnailUrl: url,
        publicId: null,
        width: null,
        height: null,
        duration: null,
        order: index,
      }));
      out.media = media;
      Object.assign(out, mediaToLegacyFields(media));
    }
  }
  if (body.featured !== undefined) out.featured = Boolean(body.featured);
  if (body.sortOrder !== undefined) {
    const order = Number(body.sortOrder);
    if (!Number.isFinite(order)) throw new Error('Sort order must be a number');
    out.sortOrder = Math.round(order);
  }
  if (body.publish !== undefined) out.publish = Boolean(body.publish);
  return out;
};

/**
 * Admin product catalog (role-gated at the route). Whitelisted fields
 * only; updates never duplicate the row.
 */
const persistedFields = (fields = {}) => {
  const {
    publish,
    targetPlatformContributionPct,
    targetPartnerMarginPct,
    ...rest
  } = fields;
  return rest;
};

const pricingInputFor = (fields = {}, existing = {}) => ({
  pricingMode: fields.pricingMode ?? existing.pricingMode ?? 'resale',
  price: fields.price ?? existing.price ?? 0,
  partnerPrice: fields.partnerPrice ?? existing.partnerPrice ?? 0,
  retailPrice: fields.retailPrice ?? existing.retailPrice ?? 0,
  commissionable: fields.commissionable ?? existing.commissionable ?? false,
  mentorBonus: fields.mentorBonus ?? existing.mentorBonus ?? 0,
  costBreakdown: fields.costBreakdown ?? existing.costBreakdown ?? null,
  targetPlatformContributionPct: fields.targetPlatformContributionPct
    ?? existing.pricing?.targetPlatformContributionPct,
  targetPartnerMarginPct: fields.targetPartnerMarginPct
    ?? existing.pricing?.targetPartnerMarginPct,
});

const pricingForProduct = (fields = {}, existing = {}) => {
  const input = pricingInputFor(fields, existing);
  if (!input.costBreakdown) return null;
  return {
    ...buildPricingSnapshot(input),
    mode: normalizePricingMode(input.pricingMode),
    computedAt: new Date(),
  };
};

const mediaCountFor = (fields = {}, existing = {}) => {
  if (fields.media !== undefined) return Array.isArray(fields.media) ? fields.media.length : 0;
  if (Array.isArray(existing.media) && existing.media.length > 0) return existing.media.length;
  return mediaForProduct(existing).length;
};

const assertPublishable = (fields = {}, existing = {}, { requireCosts = true } = {}) => {
  const reasons = [];
  if (mediaCountFor(fields, existing) < 1) {
    reasons.push('Add at least one image or video before publishing.');
  }
  if (mediaCountFor(fields, existing) > 5) {
    reasons.push('A product can have at most 5 images or videos.');
  }
  const pricing = fields.pricing ?? pricingForProduct(fields, existing);
  if (requireCosts && !(fields.costBreakdown ?? existing.costBreakdown)) {
    reasons.push('Complete the cost breakdown before publishing.');
  }
  if (!pricing) {
    reasons.push('Pricing has not been calculated. Add costs and set the selling price.');
  } else {
    const check = validatePublishPricing(pricing);
    if (!check.ok) reasons.push(...check.reasons);
  }
  if (reasons.length > 0) {
    throw new AppError(
      reasons[0],
      400,
      'PRODUCT_NOT_PUBLISHABLE',
      { reasons },
      'Adjust the product cost or price until the pricing check passes.',
    );
  }
};

export const previewProductPricing = async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = computeProductPricing({
      mode: body.pricingMode ?? body.mode,
      price: body.price,
      partnerPrice: body.partnerPrice,
      retailPrice: body.retailPrice,
      commissionable: body.commissionable !== false,
      mentorBonus: body.mentorBonus ?? 0,
      costBreakdown: cleanCostBreakdown(body.costBreakdown) ?? {},
      policy: pricingOverrides(body),
    });
    res.status(200).json({ message: 'Pricing preview', data: result, success: true });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Unable to calculate pricing', success: false });
  }
};

export const adminCreateProduct = async (req, res) => {
  try {
    const fields = cleanProductFields(req.body ?? {});
    if (!fields.name) {
      return res.status(400).json({ message: 'Product name is required', success: false });
    }
    const requestedStatus = fields.publish === true ? 'active' : (fields.status ?? 'draft');
    if (requestedStatus !== 'draft' && fields.price === undefined) {
      return res.status(400).json({ message: 'Product name and price are required', success: false });
    }

    const pricing = pricingForProduct(fields, {});
    fields.status = requestedStatus;
    if (pricing) fields.pricing = pricing;
    if (requestedStatus === 'active') {
      assertPublishable({ ...fields, pricing }, {});
      fields.publishedAt = new Date();
    }

    const product = await ProductModel.create(persistedFields(fields));
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'product.create',
      targetType: 'product', targetId: String(product._id),
      detail: {
        name: product.name,
        price: product.price,
        status: product.status,
        pricingStatus: product.pricing?.status ?? null,
      },
    });
    res.status(200).json({ message: 'Product created successfully!', data: product, success: true });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        details: error.details,
        success: false,
      });
    }
    res.status(400).json({ message: error.message || 'Error creating product', success: false });
  }
};

export const adminUpdateProduct = async (req, res) => {
  try {
    const existing = await ProductModel.findById(req.params.id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }
    const fields = cleanProductFields(req.body ?? {});
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ message: 'Nothing to update', success: false });
    }

    const targetStatus = fields.publish === true ? 'active' : (fields.status ?? existing.status);
    if (fields.publish === true) fields.status = 'active';
    const merged = { ...existing, ...fields };
    const pricing = pricingForProduct(fields, existing);
    if (pricing) fields.pricing = pricing;

    if (targetStatus === 'active') {
      if (fields.publish === true || existing.status !== 'active') {
        assertPublishable({ ...merged, pricing }, existing, {
          requireCosts: fields.publish === true || Boolean(merged.costBreakdown),
        });
      } else if (merged.costBreakdown) {
        // Editing an already-active product with a cost breakdown keeps the
        // profitability gate in force.
        assertPublishable({ ...merged, pricing }, existing);
      }
      if (existing.status !== 'active') fields.publishedAt = new Date();
    }

    const removedAssets = [];
    if (fields.media !== undefined) {
      const previous = Array.isArray(existing.media) ? existing.media : [];
      const nextIds = new Set(fields.media.map((item) => item.publicId).filter(Boolean));
      for (const item of previous) {
        if (item.publicId && !nextIds.has(item.publicId)) {
          removedAssets.push({
            publicId: item.publicId,
            resourceType: item.type === 'video' ? 'video' : 'image',
          });
        }
      }
    }

    const updated = await ProductModel.findByIdAndUpdate(
      req.params.id,
      { $set: persistedFields(fields) },
      { new: true },
    ).lean();
    if (!updated) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }

    if (removedAssets.length > 0) {
      const mediaStore = buildImageStore({
        ...(env.cloudinary ?? {}),
        folder: process.env.CLOUDINARY_PRODUCT_FOLDER || 'marketspase-products',
        label: 'Product media',
      });
      await Promise.all(removedAssets.map((asset) => (
        mediaStore.destroy(asset.publicId, { resourceType: asset.resourceType }).catch(() => null)
      )));
    }

    void recordAudit({
      actorId: req.auth?.partnerId, action: 'product.update',
      targetType: 'product', targetId: String(updated._id),
      detail: {
        fields: Object.keys(fields),
        status: updated.status,
        pricingStatus: updated.pricing?.status ?? null,
        platformContribution: updated.pricing?.platformContribution ?? null,
      },
    });
    res.status(200).json({ message: 'Product updated successfully!', data: updated, success: true });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        details: error.details,
        success: false,
      });
    }
    res.status(400).json({ message: error.message || 'Error updating product', success: false });
  }
};

/** Explicit publish action used by the wizard and the product table. */
export const publishProduct = async (req, res) => {
  try {
    const existing = await ProductModel.findById(req.params.id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }
    const pricing = pricingForProduct({}, existing);
    assertPublishable({ ...existing, pricing }, existing);
    const updated = await ProductModel.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: 'active',
          pricing,
          publishedAt: existing.publishedAt ?? new Date(),
        },
      },
      { new: true },
    ).lean();
    void recordAudit({
      actorId: req.auth?.partnerId,
      action: 'product.publish',
      targetType: 'product',
      targetId: String(updated._id),
      detail: {
        pricingStatus: pricing?.status ?? null,
        platformContribution: pricing?.platformContribution ?? null,
      },
    });
    res.status(200).json({ message: 'Product published', data: updated, success: true });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        details: error.details,
        success: false,
      });
    }
    res.status(400).json({ message: error.message || 'Unable to publish product', success: false });
  }
};

const productMediaStore = () => buildImageStore({
  ...(env.cloudinary ?? {}),
  folder: process.env.CLOUDINARY_PRODUCT_FOLDER || 'marketspase-products',
  label: 'Product media',
});

const syncProductMediaLegacy = (product) => {
  const media = Array.isArray(product.media) ? product.media : [];
  const legacy = mediaToLegacyFields(media);
  product.img = legacy.img;
  product.gallery = legacy.gallery;
};

export const uploadProductMedia = async (req, res) => {
  const product = await ProductModel.findById(req.params.id);
  let stored = null;
  try {
    if (!product) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ message: 'Choose an image or video to upload', success: false });
    }
    const current = mediaForProduct(product.toObject());
    if (current.length >= 5) {
      return res.status(400).json({ message: 'A product can have at most 5 media items', success: false });
    }
    const type = String(req.file.mimetype ?? '').startsWith('video/') ? 'video' : 'image';
    if (type === 'image' && req.file.size > 8 * 1024 * 1024) {
      return res.status(400).json({ message: 'Images must be 8 MB or smaller', success: false });
    }
    const mediaStore = productMediaStore();
    stored = await mediaStore.upload(req.file.buffer, {
      resourceType: type,
      publicId: `product-${product._id}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    });
    const media = {
      type,
      url: stored.url,
      publicId: stored.publicId,
      thumbnailUrl: stored.thumbnailUrl || (type === 'image' ? stored.url : ''),
      width: stored.width ?? null,
      height: stored.height ?? null,
      duration: stored.duration ?? null,
      order: current.length,
    };
    if (!Array.isArray(product.media)) product.media = [];
    if (product.media.length === 0) {
      // Preserve legacy img/gallery URLs when the first real upload happens.
      product.media.push(...mediaForProduct(product.toObject()).map((item, index) => ({
        ...item,
        order: index,
      })));
      media.order = product.media.length;
    }
    product.media.push(media);
    syncProductMediaLegacy(product);
    await product.save();
    void recordAudit({
      actorId: req.auth?.partnerId,
      action: 'product.media.add',
      targetType: 'product',
      targetId: String(product._id),
      detail: { type, publicId: stored.publicId, count: product.media.length },
    });
    const saved = product.media[product.media.length - 1];
    return res.status(200).json({
      message: `${type === 'video' ? 'Video' : 'Image'} uploaded`,
      data: {
        id: String(saved._id),
        type: saved.type,
        url: saved.url,
        publicId: saved.publicId,
        thumbnailUrl: saved.thumbnailUrl,
        width: saved.width,
        height: saved.height,
        duration: saved.duration,
        order: saved.order,
      },
      success: true,
    });
  } catch (error) {
    if (stored?.publicId) {
      await productMediaStore().destroy(stored.publicId, { resourceType: stored.resourceType }).catch(() => null);
    }
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code, success: false });
    }
    return res.status(400).json({ message: error.message || 'Unable to upload media', success: false });
  }
};

export const deleteProductMedia = async (req, res) => {
  try {
    const product = await ProductModel.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }
    const media = Array.isArray(product.media) ? product.media : [];
    const item = media.id?.(req.params.mediaId)
      ?? media.find((entry) => String(entry.publicId) === String(req.params.mediaId));
    if (!item) {
      return res.status(404).json({ message: 'Media item not found', success: false });
    }
    if (product.status === 'active' && media.length <= 1) {
      return res.status(400).json({
        message: 'An active product must keep at least one image or video',
        success: false,
      });
    }
    const publicId = item.publicId;
    const resourceType = item.type === 'video' ? 'video' : 'image';
    item.deleteOne();
    syncProductMediaLegacy(product);
    await product.save();
    if (publicId) {
      await productMediaStore().destroy(publicId, { resourceType }).catch(() => null);
    }
    void recordAudit({
      actorId: req.auth?.partnerId,
      action: 'product.media.remove',
      targetType: 'product',
      targetId: String(product._id),
      detail: { publicId, resourceType },
    });
    return res.status(200).json({ message: 'Media removed', data: { id: req.params.mediaId }, success: true });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code, success: false });
    }
    return res.status(400).json({ message: error.message || 'Unable to remove media', success: false });
  }
};


  
// get all products
export const getAllProducts = async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
      const skip = Math.max(Number(req.query.skip) || 0, 0);
      const q = cleanText(req.query.q, 120);
      const filter = { status: { $nin: ['draft', 'inactive', 'archived'] } };
      if (q) {
        const regex = new RegExp(escapeRegex(q), 'i');
        filter.$or = [
          { name: regex },
          { shortDesc: regex },
          { desc: regex },
          { category: regex },
          { sku: regex },
        ];
      }
      // Hidden rows stay in the database for order history, but never show
      // in the member/partner catalog.
      const [products, total] = await Promise.all([
        ProductModel.find(filter)
          .select('-cogs -shippingCost -retailPrice -commissionable -costBreakdown -pricing -mentorBonus')
          .sort({ sortOrder: 1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        ProductModel.countDocuments(filter),
      ]);

      if (q && total === 0 && mongoose.connection?.readyState === 1) {
        void SearchMissModel.create({
          q,
          partnerId: null,
          groups: { products: 0 },
        }).catch(() => null);
      }

      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.status(200).json({
        message: 'Products retrieved successfully!',
        data: products.map(toPublicProduct),
        meta: {
          q: q || null,
          count: products.length,
          total,
          limit,
          skip,
          hasMore: skip + products.length < total,
          next_action: skip + products.length < total ? 'load_more' : null,
        },
        success: true,
      });

    } catch (error) {
      res.status(500).json({
        message: 'Error retrieving products',
        error: error.message,
        success: false,
      });
    }
  };

// Admin catalog: full docs including cost/commission fields.
export const listProductsForAdmin = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const [products, total] = await Promise.all([
      ProductModel.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ProductModel.countDocuments({}),
    ]);
    res.status(200).json({
      message: 'Products retrieved successfully!',
      data: products,
      meta: {
        count: products.length,
        total,
        limit,
        skip,
        hasMore: skip + products.length < total,
        next_action: skip + products.length < total ? 'load_more' : null,
      },
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error retrieving products',
      error: error.message,
      success: false,
    });
  }
};

// Partner-only resale catalog: partner price and suggested retail.
export const listResaleProducts = async (req, res) => {
  try {
    const partner = await PartnersModel.findById(req.auth?.partnerId)
      .select('accountState kycStatus suspendedAt')
      .lean();
    if (!partner || !canBuyResale(partner)) {
      return res.status(403).json({
        message: 'Resale pricing is available to verified partners',
        success: false,
      });
    }

    const products = await ProductModel.find({
      status: { $nin: ['draft', 'inactive', 'archived'] },
      partnerPrice: { $gt: 0 },
      pricingMode: { $ne: 'direct' },
    })
      .select('name img gallery media category shortDesc price partnerPrice retailPrice stock featured sortOrder')
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    res.status(200).json({
      message: 'Resale products retrieved successfully!',
      data: products.map((product) => toPublicProduct(product, { includeResale: true })),
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error retrieving resale products',
      error: error.message,
      success: false,
    });
  }
};

// get one product for the full product page
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-fA-F0-9]{24}$/.test(String(id))) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }
    const product = await ProductModel.findOne({
      _id: id,
      status: { $nin: ['draft', 'inactive', 'archived'] },
    })
      .select('-cogs -shippingCost -retailPrice -commissionable -costBreakdown -pricing -mentorBonus')
      .lean();
    if (!product) {
      return res.status(404).json({ message: 'Product not found', success: false });
    }
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.status(200).json({
      message: 'Product retrieved successfully!',
      data: toPublicProduct(product),
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error retrieving product',
      error: error.message,
      success: false,
    });
  }
};


// Save cart  
export const Savecart = async (req, res) => {  
  try {  
    const { products } = req.body;
    const partnerId = req.auth?.partnerId;

    if (!partnerId) {
      return res.status(401).json({
        message: 'Sign in to place an order',
        success: false,
      });
    }

    // Find the partner by ID  
    const partner = await PartnersModel.findById(partnerId);  
    if (!partner) {  
      return res.status(400).json({  
        message: 'Partner not found',  
        success: false,
      });  
    }  

    const shipping = cleanShipping(req.body.shipping) ?? cleanShipping({
      fullName: [partner.name, partner.surname].filter(Boolean).join(' '),
      phone: partner.phone,
      street: partner.address?.street,
      city: partner.address?.city,
      state: partner.address?.state,
      country: partner.address?.country,
    });
    if (!shipping) {
      return res.status(400).json({
        message: 'Add a delivery address before placing this order',
        success: false,
      });
    }

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        message: 'Your cart is empty',
        success: false,
      });
    }

    const commissionPlan = productCommissionPlan();
    const orderNumber = productOrderNumber();
    const cartProducts = [];
    const marginLines = [];
    const productNames = new Map();
    let totalCost = 0;

    for (const productData of products) {  
      const product = await ProductModel.findOne({
        _id: productData._id,
        status: { $nin: ['draft', 'inactive', 'archived'] },
      });
      if (!product) {  
        return res.status(400).json({
          message: 'One of the products in your cart is no longer available. Remove it and try again.',
          success: false,
        });
      }  

      const quantity = Number(productData.quantity);  
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({
          message: 'Every cart item needs a quantity of at least one',
          success: false,
        });
      }

      const lineMode = productData.saleMode === 'resale' ? 'resale' : 'personal';
      const prices = resalePrices(product);
      const unitPrice = lineMode === 'resale' ? prices.partnerPrice : Number(product.price);
      const retailPrice = lineMode === 'resale' ? prices.retailPrice : 0;

      if (lineMode === 'resale' && !canBuyResale(partner)) {
        return res.status(403).json({
          message: 'Resale pricing is available to verified partners',
          success: false,
        });
      }

      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return res.status(400).json({
          message: lineMode === 'resale'
            ? `Product "${product.name ?? 'item'}" does not have a resale price yet. Contact support.`
            : `Product "${product.name ?? 'item'}" is price-on-request. Contact support before ordering.`,
          success: false,
        });
      }

      const cogs = Math.max(Number(product.cogs) || 0, 0);
      const shippingCost = Math.max(Number(product.shippingCost) || 0, 0);
      const commissionable = product.commissionable === true && cogs > 0;
      const stockTracked = isStockTracked(product);
      const productId = String(product._id);

      totalCost += unitPrice * quantity;
      cartProducts.push({
        product: product._id,
        quantity,
        price: unitPrice,
        cogs,
        shippingCost,
        commissionable,
        saleMode: lineMode,
        retailPrice,
        stockTracked,
      });
      marginLines.push({ price: unitPrice, quantity, cogs, shippingCost, commissionable });

      productNames.set(productId, product.name ?? 'Product');
    }  

    const stockRequired = aggregateStockRequirements(cartProducts);

    if (totalCost <= 0 || cartProducts.length === 0) {
      return res.status(400).json({
        message: 'Order total must be greater than zero',
        success: false,
      });
    }

    const saleMode = cartSaleMode(cartProducts);
    const { grossMargin, commissionableMargin } = summarizeProductMargins(marginLines);
    const now = new Date();

    // Stock, wallet debit, ledger row and order commit together. If any step
    // fails the whole transaction rolls back, so stock cannot leak and money
    // cannot be debited without an order.
    const { cart } = await runInTransaction(async (session) => {
      const opts = session ? { session } : {};

      for (const [productId, quantity] of stockRequired) {
        const reserved = await ProductModel.findOneAndUpdate(
          { _id: productId, stock: { $gte: quantity } },
          { $inc: { stock: -quantity } },
          { new: true, ...opts },
        );
        if (!reserved) {
          throw new AppError(
            `Not enough stock for ${productNames.get(productId) ?? 'a product'}. Reduce the quantity or remove it.`,
            409,
            'INSUFFICIENT_STOCK',
          );
        }
      }

      const buyer = await PartnersModel.findOneAndUpdate(
        { _id: partnerId, balance: { $gte: totalCost } },
        { $inc: { balance: -totalCost } },
        { new: true, ...opts },
      ).lean();
      if (!buyer) {
        throw new AppError('Insufficient wallet balance', 409, 'INSUFFICIENT_BALANCE');
      }

      await TransactionModel.create(
        [{
          partnerId,
          amount: totalCost,
          balanceBefore: Number(buyer.balance ?? 0) + Number(totalCost),
          balanceAfter: buyer.balance ?? null,
          status: 'Completed',
          paymentMethod: 'Product Purchase',
          transactionType: 'Debit',
          reference: orderNumber,
          date: now,
        }],
        opts,
      );

      const [created] = await CartModel.create(
        [{
          orderNumber,
          products: cartProducts,
          totalCost,
          grossMargin,
          commissionableMargin,
          commissionPlan,
          saleMode,
          shipping,
          paymentMethod: 'Wallet',
          paymentReference: orderNumber,
          partner: partnerId,
        }],
        opts,
      );

      return { cart: created, buyer };
    });

    // Growth-plan orders accrue here. A failure never blocks the paid order;
    // fulfilment retries the accrual before releasing.
    let commission = null;
    if (commissionPlan === 'growth') {
      try {
        const result = await new AccrueProductCommissionsUseCase({ repo: productCommissionRepo() })
          .execute(cart._id);
        commission = {
          entries: result.entries?.length ?? 0,
          deduped: !!result.deduped,
        };
      } catch (commissionError) {
        console.error('Product commission accrual failed:', commissionError?.message ?? commissionError);
        commission = { error: true };
      }
    }

    // Mail is best-effort: a provider failure must not make the client think
    // the paid order failed.
    try {
      const emailSubject = `Product order ${orderNumber}`;
      const emailMessage = `
          <h1>New product order</h1>
          <p>Order ${orderNumber} has been paid from the wallet.</p>
          <p>Buyer: ${shipping.fullName} (${shipping.phone})</p>
          <p>Deliver to: ${shipping.street}, ${shipping.city}, ${shipping.state}, ${shipping.country}</p>
      `;
      for (const email of ['ago.fnc@gmail.com']) {
        await sendEmail(email, emailSubject, emailMessage);
      }
    } catch (emailError) {
      console.error('Product order email failed:', emailError?.message ?? emailError);
    }

    res.status(200).json({
        message: 'Order placed successfully',
        success: true,
        data: {
          cartId: cart._id,
          orderNumber,
          commissionPlan,
          commission,
        },
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        success: false,
      });
    }
    res.status(500).json({
        message: 'Failed to save cart',
        error: error.message,
        success: false,
    });
  }
}

// Fetch all carts
export const GetAllCartsBy = async (req, res) => {  
  try {  
    const { partnerId } = req.params;   
    if (!req.auth?.partnerId || String(req.auth.partnerId) !== String(partnerId)) {
      return res.status(403).json({
        message: 'You can only view your own orders',
        success: false,
      });
    }

    // Fetch carts and populate the products field. Cost/margin snapshots are
    // internal — the buyer sees what they paid, not what the platform paid.
    const carts = await CartModel.find({ partner: partnerId })
      .select('-grossMargin -commissionableMargin -commissionPlan -products.cogs -products.shippingCost -products.commissionable')
      .sort({ createdAt: -1 })
      .populate({  
        path: 'products.product', // Populate the product field within products  
        model: 'Product', // Specify the model to populate
        select: 'name price img category desc',
      });  

    res.status(200).json({
        data: carts, 
        message: 'Carts retrieved successfully', 
        success: true
    });  
  } catch (error) {  
    res.status(500).json({ 
        message: 'Failed to fetch carts',
         error: error.message,
        success: false,
    });  
  }  
}