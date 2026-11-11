import mongoose from 'mongoose';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { CartModel, ProductModel } from '../../../apps/product/models/product.model.js';
import { PartnersModel, runInTransaction } from '../../identity-access/infrastructure/Auth.models.js';
import { partnerCapabilities } from '../../identity-access/domain/PartnerCapabilities.js';
import {
  StoreInventoryModel,
  StoreModel,
  StoreProductModel,
  StoreStockLedgerModel,
} from './Store.models.js';
import { refreshStoreInStock } from './StoreInventoryFlags.js';

const hasId = (value) => /^[a-fA-F0-9]{24}$/.test(String(value ?? ''));
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const encodeStoreCursor = (updatedAt, id) => Buffer.from(JSON.stringify({
  at: new Date(updatedAt).toISOString(),
  id: String(id),
})).toString('base64url');
const decodeStoreCursor = (cursor) => {
  if (!cursor) return null;
  try {
    const raw = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    const at = new Date(raw?.at);
    if (!raw?.id || Number.isNaN(at.getTime()) || !/^[a-fA-F0-9]{24}$/.test(String(raw.id))) {
      return null;
    }
    return { at, id: new mongoose.Types.ObjectId(String(raw.id)) };
  } catch {
    return null;
  }
};
const labelOf = (partner) => (
  [partner?.name, partner?.surname].filter(Boolean).join(' ') || partner?.username || 'Partner'
);

const legacyProductMedia = (product = {}) => {
  const urls = [product.image, ...(product.images ?? [])]
    .map((url) => String(url ?? '').trim())
    .filter(Boolean);
  return [...new Set(urls)].slice(0, 5).map((url, index) => ({
    type: 'image',
    url,
    thumbnailUrl: url,
    order: index,
  }));
};

const mergeCatalogMedia = (listing, product) => {
  if (!product) return listing;
  const media = Array.isArray(product.media) && product.media.length > 0
    ? product.media
    : listing.media;
  return {
    ...listing,
    media: media ?? [],
    image: product.img || listing.image,
    images: (product.gallery?.length ? product.gallery : listing.images) ?? [],
  };
};

const publicProduct = (product) => {
  const media = Array.isArray(product.media) && product.media.length > 0
    ? product.media.map((item, index) => ({
      type: item.type === 'video' ? 'video' : 'image',
      url: item.url ?? '',
      thumbnailUrl: item.thumbnailUrl ?? (item.type === 'video' ? '' : item.url ?? ''),
      width: item.width ?? null,
      height: item.height ?? null,
      duration: item.duration ?? null,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    })).sort((a, b) => a.order - b.order)
    : legacyProductMedia(product);
  return {
    id: String(product._id),
    productId: String(product.productId),
    name: product.name,
    image: product.image ?? '',
    images: product.images ?? [],
    media,
    category: product.category ?? 'Essentials',
    shortDesc: product.shortDesc ?? '',
    description: product.description ?? '',
    retailPrice: Number(product.retailPrice) || 0,
    stock: Number(product.stock) || 0,
    soldCount: Number(product.soldCount) || 0,
    status: product.status,
  };
};

const publicStore = (store, productCount = 0, categories = []) => ({
  id: String(store._id),
  slug: store.slug,
  name: store.name || store.slug,
  tagline: store.tagline ?? '',
  bio: store.bio ?? '',
  logo: store.logo ?? '',
  banner: store.banner ?? '',
  whatsapp: store.whatsapp ?? '',
  phone: store.phone ?? '',
  instagram: store.instagram ?? '',
  tiktok: store.tiktok ?? '',
  facebook: store.facebook ?? '',
  x: store.x ?? '',
  youtube: store.youtube ?? '',
  deliveryNote: store.deliveryNote ?? '',
  deliveryFee: Number(store.deliveryFee) || 0,
  returnPolicy: store.returnPolicy ?? '',
  status: store.status,
  productCount,
  categories,
  inStockCount: Number(store.inStockCount) || 0,
});

const privateStore = (store) => ({
  ...publicStore(store),
  autoPublish: store.autoPublish === true,
  createdAt: store.createdAt,
  updatedAt: store.updatedAt,
});

export class StoreRepository {
  async ensureStore(partnerId) {
    if (!hasId(partnerId)) throw new ValidationException('Invalid partner');
    const partner = await PartnersModel.findById(partnerId)
      .select('name surname username storeSlug phone profileImage accountState kycStatus suspendedAt')
      .lean();
    if (!partner) throw new NotFoundException('Partner not found');
    if (!partnerCapabilities(partner).canOpenStore) {
      if (partner.accountState === 'member') {
        throw new ValidationException('Store is available to active partners');
      }
      if ((partner.kycStatus ?? 'not_started') !== 'verified') {
        throw new ValidationException('Complete identity verification before opening a store');
      }
      throw new ValidationException('Store is available to active partners');
    }
    const slug = String(partner.username ?? '').trim().toLowerCase();
    if (!slug) throw new ValidationException('Set a username before opening a store');

    const store = await StoreModel.findOneAndUpdate(
      { partnerId },
      {
        $setOnInsert: {
          partnerId,
          slug,
          name: labelOf(partner),
          logo: partner.profileImage ?? '',
          whatsapp: partner.phone ?? '',
          phone: partner.phone ?? '',
          status: 'draft',
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
    if (store?.slug && partner.storeSlug !== store.slug) {
      await PartnersModel.updateOne(
        { _id: partnerId },
        { $set: { storeSlug: store.slug } },
      ).catch(() => null);
    }
    return store;
  }

  async getMyStore(partnerId) {
    const store = await this.ensureStore(partnerId);
    const [published, draft, paused, pendingReceipts] = await Promise.all([
      StoreProductModel.countDocuments({ partnerId, status: 'published' }),
      StoreProductModel.countDocuments({ partnerId, status: 'draft' }),
      StoreProductModel.countDocuments({ partnerId, status: 'paused' }),
      CartModel.countDocuments({
        partner: partnerId,
        orderStatus: 'Fulfilled',
        storeReceivedAt: null,
        'products.saleMode': 'resale',
      }),
    ]);
    return {
      store: privateStore(store),
      counts: { published, draft, paused, pendingReceipts },
    };
  }

  async updateMyStore(partnerId, body = {}) {
    const store = await this.ensureStore(partnerId);
    const fields = {};

    for (const [key, max] of [
      ['name', 120],
      ['tagline', 180],
      ['bio', 4000],
      ['logo', 500],
      ['banner', 500],
      ['whatsapp', 40],
      ['phone', 40],
      ['instagram', 500],
      ['tiktok', 500],
      ['facebook', 500],
      ['x', 500],
      ['youtube', 500],
      ['deliveryNote', 2000],
      ['returnPolicy', 2000],
    ]) {
      if (body[key] !== undefined) fields[key] = text(body[key], max);
    }
    if (body.deliveryFee !== undefined) {
      const fee = Number(body.deliveryFee);
      if (!Number.isFinite(fee) || fee < 0) {
        throw new ValidationException('Delivery fee must be zero or more');
      }
      fields.deliveryFee = money(fee);
    }
    if (body.autoPublish !== undefined) fields.autoPublish = body.autoPublish === true;
    if (body.status !== undefined) {
      if (!['draft', 'published'].includes(body.status)) {
        throw new ValidationException('Store status must be draft or published');
      }
      // A store can open before its first listing. It will be reachable by
      // direct link right away and enters the public directory once at least
      // one in-stock listing is published.
      fields.status = body.status;
    }

    if (fields.name === '') fields.name = store.slug;
    const updated = await StoreModel.findByIdAndUpdate(store._id, { $set: fields }, { new: true }).lean();
    return privateStore(updated);
  }

  async listMyProducts(partnerId) {
    const products = await StoreProductModel.find({ partnerId })
      .sort({ status: 1, createdAt: -1 })
      .lean();
    return products.map((product) => ({
      ...publicProduct(product),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    }));
  }

  async updateProduct(partnerId, productId, body = {}) {
    if (!hasId(productId)) throw new ValidationException('Invalid store product');
    const product = await StoreProductModel.findOne({ _id: productId, partnerId });
    if (!product) throw new NotFoundException('Store product not found');

    const fields = {};
    if (body.retailPrice !== undefined) {
      const price = Number(body.retailPrice);
      if (!Number.isFinite(price) || price <= 0) {
        throw new ValidationException('Retail price must be greater than zero');
      }
      fields.retailPrice = money(price);
    }
    if (body.status !== undefined) {
      if (!['draft', 'published', 'paused'].includes(body.status)) {
        throw new ValidationException('Invalid listing status');
      }
      if (body.status === 'published' && Number(product.stock) <= 0) {
        throw new ConflictException('Add stock before publishing this listing');
      }
      fields.status = body.status;
    }

    if (Object.keys(fields).length === 0) {
      throw new ValidationException('Nothing to update');
    }
    const updated = await StoreProductModel.findByIdAndUpdate(
      product._id,
      { $set: fields },
      { new: true },
    ).lean();
    await refreshStoreInStock(product.storeId).catch(() => null);
    return publicProduct(updated);
  }

  async listReceipts(partnerId) {
    const carts = await CartModel.find({
      partner: partnerId,
      orderStatus: 'Fulfilled',
      'products.saleMode': 'resale',
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const productIds = [...new Set(
      carts.flatMap((cart) => (cart.products ?? [])
        .filter((item) => item.saleMode === 'resale')
        .map((item) => String(item.product))),
    )];
    const products = productIds.length
      ? await ProductModel.find({ _id: { $in: productIds } }).select('name img').lean()
      : [];
    const names = new Map(products.map((product) => [String(product._id), product]));

    return carts.map((cart) => ({
      id: String(cart._id),
      orderNumber: cart.orderNumber ?? String(cart._id).slice(-6).toUpperCase(),
      orderStatus: cart.orderStatus,
      totalCost: Number(cart.totalCost) || 0,
      createdAt: cart.createdAt,
      receivedAt: cart.storeReceivedAt ?? null,
      items: (cart.products ?? [])
        .filter((item) => item.saleMode === 'resale')
        .map((item) => {
          const product = names.get(String(item.product));
          return {
            productId: String(item.product),
            name: product?.name ?? 'Product',
            image: product?.img ?? '',
            quantity: Number(item.quantity) || 0,
            partnerPrice: Number(item.price) || 0,
            suggestedRetail: Number(item.retailPrice) || 0,
          };
        }),
    }));
  }

  async confirmReceipt(partnerId, orderId) {
    if (!hasId(orderId)) throw new ValidationException('Invalid order');
    const store = await this.ensureStore(partnerId);

    return runInTransaction(async (session) => {
      const opts = session ? { session } : {};
      const cart = await CartModel.findOneAndUpdate(
        {
          _id: orderId,
          partner: partnerId,
          orderStatus: 'Fulfilled',
          storeReceivedAt: null,
        },
        { $set: { storeReceivedAt: new Date() } },
        { new: true, ...opts },
      ).lean();
      if (!cart) {
        throw new ConflictException('This order is not ready to receive, or it was already confirmed');
      }

      const resaleItems = (cart.products ?? []).filter((item) => item.saleMode === 'resale');
      if (resaleItems.length === 0) {
        throw new ValidationException('This order has no resale items');
      }

      const productIds = [...new Set(resaleItems.map((item) => String(item.product)))];
      const products = await ProductModel.find({ _id: { $in: productIds } })
        .select('name img gallery media category shortDesc desc retailPrice price')
        .lean();
      const productMap = new Map(products.map((product) => [String(product._id), product]));

      const listings = [];
      let credited = 0;

      for (const item of resaleItems) {
        const quantity = Math.max(Number(item.quantity) || 0, 0);
        if (quantity <= 0) continue;
        const product = productMap.get(String(item.product));
        const productId = item.product;

        await StoreInventoryModel.findOneAndUpdate(
          { partnerId, productId },
          { $inc: { quantity } },
          { upsert: true, new: true, ...opts },
        );
        const listing = await StoreProductModel.findOneAndUpdate(
          { storeId: store._id, productId },
          {
            $inc: { stock: quantity },
            $setOnInsert: {
              storeId: store._id,
              partnerId,
              productId,
              name: product?.name ?? 'Product',
              image: product?.img ?? '',
              images: product?.gallery ?? [],
              media: product?.media ?? [],
              category: product?.category ?? 'Essentials',
              shortDesc: product?.shortDesc ?? '',
              description: product?.desc ?? '',
              retailPrice: money(item.retailPrice || product?.retailPrice || product?.price || 0),
              status: store.autoPublish === true ? 'published' : 'draft',
            },
          },
          { upsert: true, new: true, ...opts },
        ).lean();
        await StoreStockLedgerModel.create(
          [{
            partnerId,
            productId,
            quantity,
            type: 'wholesale_receipt',
            reference: cart.orderNumber ?? String(cart._id),
            note: 'Store stock credited from received wholesale order',
          }],
          opts,
        );
        listings.push(publicProduct(listing));
        credited += quantity;
      }

      await refreshStoreInStock(store._id, { session: session ?? undefined }).catch(() => null);

      return {
        orderNumber: cart.orderNumber ?? String(cart._id),
        credited,
        listings,
      };
    });
  }

  async listPublicStores({ q, limit = 30, cursor = null } = {}) {
    const size = Math.min(Math.max(Number(limit) || 30, 1), 50);
    const match = { status: 'published' };
    const query = text(q, 120);
    if (query) {
      const regex = new RegExp(escapeRegex(query), 'i');
      match.$or = [{ name: regex }, { slug: regex }, { tagline: regex }];
    }
    const after = decodeStoreCursor(cursor);
    if (after) {
      match.$and = [{
        $or: [
          { updatedAt: { $lt: after.at } },
          { updatedAt: after.at, _id: { $lt: after.id } },
        ],
      }];
    }

    const rows = await StoreModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: StoreProductModel.collection.name,
          let: { storeId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$storeId', '$$storeId'] },
                status: 'published',
                stock: { $gt: 0 },
              },
            },
            {
              $group: {
                _id: null,
                productCount: { $sum: 1 },
                categories: { $addToSet: '$category' },
              },
            },
          ],
          as: 'catalog',
        },
      },
      { $match: { 'catalog.0': { $exists: true } } },
      { $sort: { updatedAt: -1, _id: -1 } },
      { $limit: size + 1 },
    ]);

    const hasMore = rows.length > size;
    const page = hasMore ? rows.slice(0, size) : rows;
    const data = page.map((store) => {
      const stat = store.catalog?.[0] ?? {};
      return publicStore(store, stat.productCount ?? 0, stat.categories ?? []);
    });
    const last = page[page.length - 1];

    return {
      data,
      meta: {
        count: data.length,
        limit: size,
        hasMore,
        nextCursor: hasMore && last ? encodeStoreCursor(last.updatedAt, last._id) : null,
        next_action: hasMore ? 'load_more' : null,
      },
    };
  }

  async getPublicStore(slug) {
    const clean = text(slug, 80).toLowerCase();
    if (!clean) throw new NotFoundException('Store not found');
    let store = await StoreModel.findOne({ slug: clean, status: 'published' }).lean();
    if (!store) {
      // Username alias: older shared links used the partner username. Resolve
      // it to the immutable store slug without breaking the link.
      const partner = await PartnersModel.findOne({ username: clean }).select('_id').lean().catch(() => null);
      if (partner) {
        store = await StoreModel.findOne({ partnerId: partner._id, status: 'published' }).lean();
      }
    }
    if (!store) throw new NotFoundException('Store not found');
    const [products, partner] = await Promise.all([
      StoreProductModel.find({
        storeId: store._id,
        status: 'published',
      }).sort({ createdAt: -1 }).limit(200).lean(),
      PartnersModel.findById(store.partnerId)
        .select([
          'username', 'headline', 'subHeadline', 'heroBadge', 'businessTagline',
          'aboutStory', 'achievements', 'inviteNote', 'opportunityPoints',
          'videoTestimonialUrl', 'displayPhone', 'displayEmail', 'locationDisplay',
          'whatsappCtaText', 'testimonial', 'jobTitle', 'bio',
          'whatsappGroupLink', 'whatsappChatLink',
        ].join(' '))
        .lean()
        .catch(() => null),
    ]);
    const productIds = [...new Set(products.map((product) => String(product.productId)))];
    const catalogProducts = productIds.length
      ? await ProductModel.find({ _id: { $in: productIds } })
        .select('media img gallery status')
        .lean()
        .catch(() => [])
      : [];
    const catalogMap = new Map(catalogProducts.map((product) => [String(product._id), product]));
    const visibleProducts = products.filter((product) => {
      const catalog = catalogMap.get(String(product.productId));
      return !catalog || !['draft', 'inactive', 'archived'].includes(catalog.status);
    });
    const publicProps = publicStore(
      store,
      visibleProducts.length,
      [...new Set(visibleProducts.map((product) => product.category).filter(Boolean))],
    );
    return {
      store: {
        ...publicProps,
        marketing: partner ? {
          username: partner.username ?? '',
          name: publicProps.name,
          heroBadge: partner.heroBadge ?? '',
          headline: partner.headline ?? '',
          subHeadline: partner.subHeadline ?? '',
          businessTagline: partner.businessTagline ?? '',
          jobTitle: partner.jobTitle ?? '',
          bio: partner.bio ?? '',
          aboutStory: partner.aboutStory ?? '',
          achievements: partner.achievements ?? '',
          locationDisplay: partner.locationDisplay ?? '',
          opportunityPoints: Array.isArray(partner.opportunityPoints)
            ? partner.opportunityPoints.filter((value) => String(value ?? '').trim()).slice(0, 8)
            : [],
          inviteNote: partner.inviteNote ?? '',
          testimonial: partner.testimonial ?? '',
          videoTestimonialUrl: partner.videoTestimonialUrl ?? '',
          whatsappCtaText: partner.whatsappCtaText ?? '',
          whatsappChatLink: partner.whatsappChatLink ?? '',
          displayPhone: partner.displayPhone ?? '',
          displayEmail: partner.displayEmail ?? '',
        } : null,
      },
      products: visibleProducts.map((product) => publicProduct(
        mergeCatalogMedia(product, catalogMap.get(String(product.productId))),
      )),
    };
  }

  async resolvePublicSlug(handle) {
    const clean = text(handle, 80).toLowerCase();
    if (!clean) throw new NotFoundException('Store not found');
    const bySlug = await StoreModel.findOne({ slug: clean, status: 'published' }).select('slug').lean();
    if (bySlug) return { slug: bySlug.slug, canonical: true };
    const partner = await PartnersModel.findOne({ username: clean }).select('_id').lean().catch(() => null);
    if (partner) {
      const store = await StoreModel.findOne({ partnerId: partner._id, status: 'published' })
        .select('slug')
        .lean();
      if (store) return { slug: store.slug, canonical: false };
    }
    throw new NotFoundException('Store not found');
  }

  async getPublicProduct(slug, productId) {
    if (!hasId(productId)) throw new NotFoundException('Product not found');
    const clean = text(slug, 80).toLowerCase();
    let store = await StoreModel.findOne({ slug: clean, status: 'published' }).lean();
    if (!store) {
      const partner = await PartnersModel.findOne({ username: clean }).select('_id').lean().catch(() => null);
      if (partner) {
        store = await StoreModel.findOne({ partnerId: partner._id, status: 'published' }).lean();
      }
    }
    if (!store) throw new NotFoundException('Store not found');
    const product = await StoreProductModel.findOne({
      _id: productId,
      storeId: store._id,
      status: 'published',
    }).lean();
    if (!product) throw new NotFoundException('Product not found');
    const catalogProduct = product.productId
      ? await ProductModel.findById(product.productId).select('media img gallery status').lean().catch(() => null)
      : null;
    if (catalogProduct && ['draft', 'inactive', 'archived'].includes(catalogProduct.status)) {
      throw new NotFoundException('Product not found');
    }
    return {
      store: publicStore(store, 0, []),
      product: publicProduct(mergeCatalogMedia(product, catalogProduct)),
    };
  }
}
