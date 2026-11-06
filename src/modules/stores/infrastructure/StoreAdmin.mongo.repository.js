import {
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import {
  StoreModel,
  StoreOrderModel,
  StoreProductModel,
} from './Store.models.js';
import { StoreOrderRepository } from './StoreOrder.mongo.repository.js';

const hasId = (value) => /^[a-fA-F0-9]{24}$/.test(String(value ?? ''));
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const baseStore = (store) => ({
  id: String(store._id),
  slug: store.slug,
  name: store.name || store.slug,
  logo: store.logo ?? '',
  banner: store.banner ?? '',
  status: store.status,
  deliveryFee: Number(store.deliveryFee) || 0,
  suspensionReason: store.suspensionReason ?? '',
  suspendedAt: store.suspendedAt ?? null,
  createdAt: store.createdAt,
  updatedAt: store.updatedAt,
});

export class StoreAdminRepository {
  constructor({ orders = new StoreOrderRepository() } = {}) {
    this.orders = orders;
  }

  async listStores({ q, status, limit = 100 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    const query = text(q, 120);
    if (query) {
      const regex = new RegExp(escapeRegex(query), 'i');
      filter.$or = [{ name: regex }, { slug: regex }, { tagline: regex }];
    }
    const stores = await StoreModel.find(filter)
      .sort({ updatedAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 200))
      .lean();
    if (stores.length === 0) return [];

    const ids = stores.map((store) => store._id);
    const [productStats, orderStats, partners] = await Promise.all([
      StoreProductModel.aggregate([
        { $match: { storeId: { $in: ids } } },
        {
          $group: {
            _id: '$storeId',
            productCount: { $sum: 1 },
            publishedCount: {
              $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] },
            },
            stockUnits: { $sum: '$stock' },
          },
        },
      ]),
      StoreOrderModel.aggregate([
        { $match: { storeId: { $in: ids } } },
        {
          $group: {
            _id: '$storeId',
            orderCount: { $sum: 1 },
            paidOrders: {
              $sum: { $cond: [{ $eq: ['$payment.status', 'paid'] }, 1, 0] },
            },
          },
        },
      ]),
      PartnersModel.find({ _id: { $in: stores.map((store) => store.partnerId) } })
        .select('username name surname email phone')
        .lean(),
    ]);

    const products = new Map(productStats.map((row) => [String(row._id), row]));
    const orders = new Map(orderStats.map((row) => [String(row._id), row]));
    const partnerMap = new Map(partners.map((partner) => [String(partner._id), partner]));

    return stores.map((store) => {
      const product = products.get(String(store._id));
      const order = orders.get(String(store._id));
      const partner = partnerMap.get(String(store.partnerId));
      return {
        ...baseStore(store),
        productCount: Number(product?.productCount) || 0,
        publishedCount: Number(product?.publishedCount) || 0,
        stockUnits: Number(product?.stockUnits) || 0,
        orderCount: Number(order?.orderCount) || 0,
        paidOrders: Number(order?.paidOrders) || 0,
        partner: partner ? {
          id: String(partner._id),
          username: partner.username ?? '',
          name: [partner.name, partner.surname].filter(Boolean).join(' ').trim(),
          email: partner.email ?? '',
          phone: partner.phone ?? '',
        } : null,
      };
    });
  }

  async getStore(storeId) {
    if (!hasId(storeId)) throw new ValidationException('Invalid store');
    const store = await StoreModel.findById(storeId).lean();
    if (!store) throw new NotFoundException('Store not found');
    const [listings, orders] = await Promise.all([
      StoreProductModel.find({ storeId: store._id }).sort({ status: 1, createdAt: -1 }).lean(),
      this.orders.listAllOrders({ storeId, limit: 25 }),
    ]);
    const partner = await PartnersModel.findById(store.partnerId)
      .select('username name surname email phone')
      .lean();
    const summary = (await this.listStores({ q: store.slug, limit: 1 }))[0] ?? baseStore(store);
    return {
      store: {
        ...summary,
        partner: partner ? {
          id: String(partner._id),
          username: partner.username ?? '',
          name: [partner.name, partner.surname].filter(Boolean).join(' ').trim(),
          email: partner.email ?? '',
          phone: partner.phone ?? '',
        } : null,
      },
      listings: listings.map((listing) => ({
        id: String(listing._id),
        productId: String(listing.productId),
        name: listing.name,
        image: listing.image ?? '',
        category: listing.category ?? 'Essentials',
        retailPrice: Number(listing.retailPrice) || 0,
        stock: Number(listing.stock) || 0,
        soldCount: Number(listing.soldCount) || 0,
        status: listing.status,
      })),
      orders,
    };
  }

  async setStoreStatus(storeId, { status, reason = '' } = {}) {
    if (!hasId(storeId)) throw new ValidationException('Invalid store');
    if (!['draft', 'published', 'suspended'].includes(status)) {
      throw new ValidationException('Invalid store status');
    }
    const now = new Date();
    const update = {
      status,
      suspensionReason: status === 'suspended' ? text(reason, 500) : '',
      suspendedAt: status === 'suspended' ? now : null,
    };
    const store = await StoreModel.findByIdAndUpdate(storeId, { $set: update }, { new: true }).lean();
    if (!store) throw new NotFoundException('Store not found');
    return (await this.listStores({ q: store.slug, limit: 1 }))[0];
  }

  listOrders(query) {
    return this.orders.listAllOrders(query);
  }

  getOrder(orderId) {
    return this.orders.getAdminOrder(orderId);
  }

  async releaseEscrow(orderId) {
    const result = await this.orders.releaseOrder(orderId, { force: true });
    if (!result) {
      throw new ValidationException('Only a delivered order with held escrow can be released');
    }
    return this.orders.getAdminOrder(orderId);
  }

  settlements() {
    return this.orders.getAdminSettlements();
  }

  settings() {
    return this.orders.getStoreSettings();
  }

  updateSettings(body) {
    return this.orders.updateStoreSettings(body);
  }
}
