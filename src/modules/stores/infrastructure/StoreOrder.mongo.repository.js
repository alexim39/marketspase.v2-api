import mongoose from 'mongoose';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { domainEvents } from '../../../shared/events/DomainEvents.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { PartnersModel, runInTransaction } from '../../identity-access/infrastructure/Auth.models.js';
import { creditPartnerWallet } from '../../billing/application/Deposit.usecases.js';
import {
  PaystackClient,
  verifyPaystackSignature,
} from '../../billing/infrastructure/PaystackClient.js';
import {
  PlatformSettingModel,
  StoreEscrowLedgerModel,
  StoreInventoryModel,
  StoreModel,
  StoreOrderModel,
  StoreProductModel,
  StoreStockLedgerModel,
} from './Store.models.js';
import {
  fromKobo,
  newStoreOrderNumber,
  newStoreOrderReference,
  storeCheckoutReturnUrl,
  storeEscrowHoldDays,
  storeOrderTtlMinutes,
  storePricing,
  storeServiceFeePercent,
  toKobo,
} from '../domain/StorePricing.js';
import { STORE_EVENTS } from '../domain/StoreEvents.js';

const hasId = (value) => /^[a-fA-F0-9]{24}$/.test(String(value ?? ''));
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const lower = (value, max) => text(value, max).toLowerCase();
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const now = () => new Date();
const terminalPaymentFailure = new Set(['failed', 'abandoned', 'reversed']);

export const publicOrder = (order) => ({
  id: String(order._id),
  reference: order.reference,
  orderNumber: order.orderNumber,
  store: {
    id: String(order.storeId),
    slug: order.storeSlug,
    name: order.storeName,
  },
  customer: {
    name: order.customer?.name ?? '',
    email: order.customer?.email ?? '',
    phone: order.customer?.phone ?? '',
    street: order.customer?.street ?? '',
    city: order.customer?.city ?? '',
    state: order.customer?.state ?? '',
    country: order.customer?.country ?? 'Nigeria',
    note: order.customer?.note ?? '',
  },
  items: (order.items ?? []).map((item) => ({
    storeProductId: String(item.storeProductId),
    productId: String(item.productId),
    name: item.name,
    image: item.image ?? '',
    category: item.category ?? 'Essentials',
    unitPrice: fromKobo(item.unitPriceKobo),
    quantity: Number(item.quantity) || 0,
    lineTotal: fromKobo(item.lineTotalKobo),
  })),
  amounts: {
    merchandise: fromKobo(order.amounts?.merchandiseKobo),
    delivery: fromKobo(order.amounts?.deliveryKobo),
    total: fromKobo(order.amounts?.totalKobo),
    serviceFee: fromKobo(order.amounts?.serviceFeeKobo),
    serviceFeePercent: Number(order.amounts?.serviceFeePercent) || 0,
    paymentFee: fromKobo(order.amounts?.paymentFeeKobo),
    partnerPending: fromKobo(order.amounts?.partnerPendingKobo),
    currency: 'NGN',
  },
  payment: {
    provider: order.payment?.provider ?? 'paystack',
    status: order.payment?.status ?? 'pending',
    reference: order.payment?.reference ?? order.reference,
    authorizationUrl: order.payment?.authorizationUrl ?? '',
    paidAt: order.payment?.paidAt ?? null,
    channel: order.payment?.channel ?? '',
    currency: order.payment?.currency ?? 'NGN',
    gatewayResponse: order.payment?.gatewayResponse ?? '',
  },
  status: order.status,
  stockReserved: order.stockReserved === true,
  stockReleased: order.stockReleased === true,
  expiresAt: order.expiresAt ?? null,
  paidAt: order.paidAt ?? null,
  processingAt: order.processingAt ?? null,
  shippedAt: order.shippedAt ?? null,
  deliveredAt: order.deliveredAt ?? null,
  cancelledAt: order.cancelledAt ?? null,
  refundedAt: order.refundedAt ?? null,
  refundReference: order.refundReference ?? '',
  refundReason: order.refundReason ?? '',
  settledAt: order.settledAt ?? null,
  escrow: {
    status: order.escrow?.status ?? 'none',
    releaseAt: order.escrow?.releaseAt ?? null,
    releasedAt: order.escrow?.releasedAt ?? null,
  },
  fulfilment: {
    courier: order.fulfilment?.courier ?? '',
    trackingNumber: order.fulfilment?.trackingNumber ?? '',
    trackingUrl: order.fulfilment?.trackingUrl ?? '',
    note: order.fulfilment?.note ?? '',
  },
  events: (order.events ?? []).map((event) => ({
    type: event.type,
    at: event.at,
    note: event.note ?? '',
  })),
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

const cleanCustomer = (customer = {}) => ({
  name: text(customer.name, 120),
  email: lower(customer.email, 254),
  phone: text(customer.phone, 30),
  street: text(customer.street, 300),
  city: text(customer.city, 120),
  state: text(customer.state, 120),
  country: text(customer.country || 'Nigeria', 80) || 'Nigeria',
  note: text(customer.note, 1000),
});

const assertCustomer = (customer) => {
  if (!customer.name || !customer.email || !customer.phone) {
    throw new ValidationException('Add your name, email and phone number');
  }
  if (!customer.street || !customer.city || !customer.state) {
    throw new ValidationException('Add a complete delivery address');
  }
};

const normaliseItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationException('Your cart is empty');
  }
  if (items.length > 20) throw new ValidationException('Too many products in one order');
  const seen = new Set();
  return items.map((item) => {
    const storeProductId = text(item?.storeProductId, 24);
    if (!hasId(storeProductId)) throw new ValidationException('Invalid store product');
    if (seen.has(storeProductId)) throw new ValidationException('Duplicate product in cart');
    seen.add(storeProductId);
    const quantity = Math.floor(Number(item?.quantity));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new ValidationException('Quantity must be between 1 and 99');
    }
    return { storeProductId, quantity };
  });
};

export class StoreOrderRepository {
  constructor({
    paystack = new PaystackClient(),
    returnUrl = storeCheckoutReturnUrl(),
    events = domainEvents,
  } = {}) {
    this.paystack = paystack;
    this.returnUrl = returnUrl;
    this.events = events;
  }

  async getStoreSettings() {
    const doc = await PlatformSettingModel.findOne({ key: 'store' }).lean().catch(() => null);
    return {
      serviceFeePercent: Number(doc?.storeServiceFeePercent ?? storeServiceFeePercent()),
      escrowHoldDays: Number(doc?.storeEscrowHoldDays ?? storeEscrowHoldDays()),
      currency: 'NGN',
    };
  }

  async updateStoreSettings({ serviceFeePercent, escrowHoldDays }) {
    const fee = Number(serviceFeePercent);
    const days = Number(escrowHoldDays);
    if (!Number.isFinite(fee) || fee < 0 || fee > 20) {
      throw new ValidationException('Store service fee must be between 0 and 20 percent');
    }
    if (!Number.isFinite(days) || days < 0 || days > 60) {
      throw new ValidationException('Escrow hold days must be between 0 and 60');
    }
    const doc = await PlatformSettingModel.findOneAndUpdate(
      { key: 'store' },
      {
        $set: {
          storeServiceFeePercent: Math.round(fee * 100) / 100,
          storeEscrowHoldDays: Math.round(days),
        },
        $setOnInsert: { key: 'store' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return {
      serviceFeePercent: Number(doc.storeServiceFeePercent) || 0,
      escrowHoldDays: Number(doc.storeEscrowHoldDays) || 0,
      currency: 'NGN',
    };
  }

  async createOrder(slug, body = {}) {
    const cleanSlug = lower(slug, 80);
    if (!cleanSlug) throw new NotFoundException('Store not found');
    const store = await StoreModel.findOne({ slug: cleanSlug, status: 'published' }).lean();
    if (!store) throw new NotFoundException('Store not found');

    const requested = normaliseItems(body.items);
    const listings = await StoreProductModel.find({
      _id: { $in: requested.map((item) => item.storeProductId) },
      storeId: store._id,
      status: 'published',
    }).lean();
    const byId = new Map(listings.map((listing) => [String(listing._id), listing]));
    if (byId.size !== requested.length) {
      throw new ConflictException('One or more products are no longer available');
    }

    const items = [];
    let merchandiseKobo = 0;
    for (const requestedItem of requested) {
      const listing = byId.get(requestedItem.storeProductId);
      if (!listing) throw new ConflictException('One or more products are no longer available');
      if (Number(listing.stock) < requestedItem.quantity) {
        throw new ConflictException(
          `${listing.name} has only ${Math.max(Number(listing.stock) || 0, 0)} left`,
        );
      }
      const unitPriceKobo = toKobo(listing.retailPrice);
      if (unitPriceKobo <= 0) {
        throw new ConflictException(`${listing.name} is not available for checkout`);
      }
      const lineTotalKobo = unitPriceKobo * requestedItem.quantity;
      items.push({
        storeProductId: listing._id,
        productId: listing.productId,
        name: listing.name,
        image: listing.image ?? '',
        category: listing.category ?? 'Essentials',
        unitPriceKobo,
        quantity: requestedItem.quantity,
        lineTotalKobo,
      });
      merchandiseKobo += lineTotalKobo;
    }

    const customer = cleanCustomer(body.customer);
    assertCustomer(customer);
    const settings = await this.getStoreSettings();
    const amounts = storePricing({
      merchandiseKobo,
      deliveryKobo: toKobo(store.deliveryFee),
      percent: settings.serviceFeePercent,
    });
    if (amounts.totalKobo <= 0) throw new ValidationException('Order total must be above zero');

    const reference = newStoreOrderReference();
    const orderNumber = newStoreOrderNumber();
    const expiresAt = new Date(Date.now() + storeOrderTtlMinutes() * 60 * 1000);
    let sessionUsed;
    let created;

    try {
      created = await runInTransaction(async (session) => {
        sessionUsed = session;
        const opts = session ? { session } : {};

        for (const item of items) {
          const reserved = await StoreProductModel.findOneAndUpdate(
            {
              _id: item.storeProductId,
              storeId: store._id,
              status: 'published',
              stock: { $gte: item.quantity },
            },
            { $inc: { stock: -item.quantity } },
            { new: true, ...opts },
          );
          if (!reserved) {
            throw new ConflictException(
              `${item.name} just went out of stock. Refresh your cart and try again.`,
            );
          }
        }

        const [order] = await StoreOrderModel.create([
          {
            reference,
            orderNumber,
            storeId: store._id,
            partnerId: store.partnerId,
            storeSlug: store.slug,
            storeName: store.name || store.slug,
            customer,
            items,
            amounts: {
              ...amounts,
              paymentFeeKobo: 0,
              partnerPendingKobo: amounts.totalKobo - amounts.serviceFeeKobo,
            },
            payment: {
              provider: 'paystack',
              status: 'pending',
              reference,
              currency: 'NGN',
            },
            status: 'pending_payment',
            stockReserved: true,
            stockReleased: false,
            expiresAt,
            escrow: { status: 'none' },
            events: [{ type: 'order_created', note: 'Awaiting payment' }],
          },
        ], opts);
        return order;
      });
    } catch (error) {
      if (!sessionUsed) {
        for (const item of items) {
          await StoreProductModel.updateOne(
            { _id: item.storeProductId, storeId: store._id },
            { $inc: { stock: item.quantity } },
          ).catch(() => null);
        }
      }
      throw error;
    }

    if (!this.paystack?.enabled) {
      await this.cancelPendingOrder(created._id, 'Payment provider is not configured');
      throw new ValidationException('Card payments are not available right now');
    }

    const callbackUrl = `${this.returnUrl}${this.returnUrl.includes('?') ? '&' : '?'}reference=${encodeURIComponent(reference)}`;
    let opened;
    try {
      opened = await this.paystack.initialize({
        reference,
        amountKobo: amounts.totalKobo,
        email: customer.email,
        callbackUrl,
        metadata: {
          product: 'store-order',
          orderId: String(created._id),
          orderNumber,
          storeId: String(store._id),
          partnerId: String(store.partnerId),
          storeSlug: store.slug,
        },
      });
    } catch (error) {
      await this.cancelPendingOrder(created._id, 'Could not open payment checkout');
      throw new ValidationException(`Could not open checkout: ${error?.message ?? 'provider error'}`);
    }

    const updated = await StoreOrderModel.findByIdAndUpdate(
      created._id,
      {
        $set: {
          'payment.authorizationUrl': opened.authorizationUrl,
          'payment.accessCode': opened.accessCode ?? '',
        },
      },
      { new: true },
    ).lean();

    return {
      order: publicOrder(updated),
      checkoutUrl: opened.authorizationUrl,
    };
  }

  async getOrder(reference) {
    const clean = text(reference, 80);
    if (!clean) throw new NotFoundException('Order not found');
    const order = await StoreOrderModel.findOne({ reference: clean }).lean();
    if (!order) throw new NotFoundException('Order not found');
    return publicOrder(order);
  }

  async verifyOrder(reference) {
    const clean = text(reference, 80);
    if (!clean) throw new NotFoundException('Order not found');
    const order = await StoreOrderModel.findOne({ reference: clean }).lean();
    if (!order) throw new NotFoundException('Order not found');
    if (order.payment?.status === 'paid') return { order: publicOrder(order), status: 'paid' };
    if (order.status === 'cancelled') {
      return { order: publicOrder(order), status: 'cancelled' };
    }
    if (!this.paystack?.enabled) {
      throw new ValidationException('Card payments are not available right now');
    }

    let live;
    try {
      live = await this.paystack.verify(clean);
    } catch (error) {
      throw new ValidationException(`Could not confirm payment: ${error?.message ?? 'provider error'}`);
    }

    const paymentStatus = lower(live?.status, 30);
    if (paymentStatus === 'success') {
      if (Number(live?.amount) !== Number(order.amounts?.totalKobo)) {
        throw new ConflictException('Paystack amount does not match this order');
      }
      if (String(live?.currency ?? 'NGN').toUpperCase() !== 'NGN') {
        throw new ConflictException('Paystack currency does not match this order');
      }
      const settled = await this.settleOrder(order, live);
      const fresh = await StoreOrderModel.findById(order._id).lean();
      return { order: publicOrder(fresh), status: settled.deduped ? 'paid' : 'paid', deduped: settled.deduped === true };
    }

    if (terminalPaymentFailure.has(paymentStatus)) {
      await this.cancelPendingOrder(order._id, 'Payment was not completed');
      const fresh = await StoreOrderModel.findById(order._id).lean();
      return { order: publicOrder(fresh), status: 'cancelled' };
    }

    return { order: publicOrder(order), status: order.payment?.status ?? 'pending' };
  }

  async settleOrder(order, live) {
    const totalKobo = Number(order.amounts?.totalKobo) || 0;
    const serviceFeeKobo = Number(order.amounts?.serviceFeeKobo) || 0;
    const rawFee = Number(live?.fees);
    const paymentFeeKobo = Number.isFinite(rawFee)
      ? Math.min(Math.max(Math.round(rawFee), 0), totalKobo)
      : 0;
    const partnerPendingKobo = Math.max(totalKobo - serviceFeeKobo - paymentFeeKobo, 0);
    const paidAt = new Date();

    const result = await runInTransaction(async (session) => {
      const opts = session ? { session } : {};
      const claimed = await StoreOrderModel.findOneAndUpdate(
        {
          _id: order._id,
          'payment.status': { $ne: 'paid' },
          status: { $in: ['pending_payment', 'paid'] },
        },
        {
          $set: {
            status: 'paid',
            paidAt,
            'payment.status': 'paid',
            'payment.paidAt': paidAt,
            'payment.channel': text(live?.channel, 40),
            'payment.currency': String(live?.currency ?? 'NGN').toUpperCase(),
            'payment.gatewayResponse': text(live?.gateway_response ?? live?.message, 300),
            'amounts.paymentFeeKobo': paymentFeeKobo,
            'amounts.partnerPendingKobo': partnerPendingKobo,
            'escrow.status': 'held',
          },
          $push: {
            events: {
              type: 'payment_confirmed',
              at: paidAt,
              note: 'Payment confirmed by Paystack',
            },
          },
        },
        { new: true, ...opts },
      ).lean();
      if (!claimed) return { deduped: true };

      for (const item of claimed.items ?? []) {
        const quantity = Number(item.quantity) || 0;
        if (quantity <= 0) continue;
        await StoreInventoryModel.updateOne(
          { partnerId: claimed.partnerId, productId: item.productId },
          { $inc: { quantity: -quantity } },
          opts,
        );
        await StoreProductModel.updateOne(
          { _id: item.storeProductId, partnerId: claimed.partnerId },
          { $inc: { soldCount: quantity } },
          opts,
        );
        await StoreStockLedgerModel.create(
          [{
            partnerId: claimed.partnerId,
            productId: item.productId,
            quantity: -quantity,
            type: 'store_sale',
            reference: claimed.reference,
            note: 'Store order paid',
          }],
          opts,
        );
      }

      await StoreEscrowLedgerModel.create(
        [
          {
            orderId: claimed._id,
            reference: claimed.reference,
            partnerId: claimed.partnerId,
            type: 'customer_payment',
            amountKobo: totalKobo,
            note: 'Customer payment received',
          },
          {
            orderId: claimed._id,
            reference: claimed.reference,
            partnerId: claimed.partnerId,
            type: 'service_fee',
            amountKobo: -serviceFeeKobo,
            note: 'MarketSpase store service fee',
          },
          {
            orderId: claimed._id,
            reference: claimed.reference,
            partnerId: claimed.partnerId,
            type: 'payment_fee',
            amountKobo: -paymentFeeKobo,
            note: 'Paystack processing fee',
          },
          {
            orderId: claimed._id,
            reference: claimed.reference,
            partnerId: claimed.partnerId,
            type: 'partner_pending',
            amountKobo: partnerPendingKobo,
            note: 'Held in escrow until delivery plus return window',
          },
        ],
        opts,
      );

      return { deduped: false, paymentFeeKobo, partnerPendingKobo };
    });

    if (!result.deduped) {
      void this.events?.emit?.(STORE_EVENTS.ORDER_PAID, {
        orderId: String(order._id),
        partnerId: String(order.partnerId),
        reference: order.reference,
        orderNumber: order.orderNumber,
        customerName: order.customer?.name ?? 'A customer',
        total: fromKobo(order.amounts?.totalKobo),
        currency: 'NGN',
      });
    }

    return result;
  }

  async listPartnerOrders(partnerId, { status, limit = 100 } = {}) {
    if (!hasId(partnerId)) throw new ValidationException('Invalid partner');
    const filter = { partnerId: new mongoose.Types.ObjectId(partnerId) };
    if (status) filter.status = status;
    const orders = await StoreOrderModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 100))
      .lean();
    return orders.map(publicOrder);
  }

  async getPartnerEarnings(partnerId) {
    if (!hasId(partnerId)) throw new ValidationException('Invalid partner');
    const partnerObjectId = new mongoose.Types.ObjectId(partnerId);
    const [totals, counts] = await Promise.all([
      StoreOrderModel.aggregate([
        { $match: { partnerId: partnerObjectId } },
        {
          $group: {
            _id: null,
            pendingKobo: {
              $sum: {
                $cond: [{ $eq: ['$escrow.status', 'held'] }, '$amounts.partnerPendingKobo', 0],
              },
            },
            releasedKobo: {
              $sum: {
                $cond: [{ $eq: ['$escrow.status', 'released'] }, '$amounts.partnerPendingKobo', 0],
              },
            },
            paidOrders: {
              $sum: { $cond: [{ $eq: ['$payment.status', 'paid'] }, 1, 0] },
            },
            pendingOrders: {
              $sum: { $cond: [{ $eq: ['$status', 'pending_payment'] }, 1, 0] },
            },
            awaitingDelivery: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['paid', 'processing', 'shipped']] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      StoreOrderModel.aggregate([
        { $match: { partnerId: partnerObjectId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);
    const row = totals[0] ?? {};
    const settings = await this.getStoreSettings();
    return {
      pending: fromKobo(row.pendingKobo),
      released: fromKobo(row.releasedKobo),
      paidOrders: Number(row.paidOrders) || 0,
      pendingOrders: Number(row.pendingOrders) || 0,
      awaitingDelivery: Number(row.awaitingDelivery) || 0,
      counts: Object.fromEntries((counts ?? []).map((entry) => [entry._id, entry.count])),
      escrowHoldDays: settings.escrowHoldDays,
      currency: 'NGN',
    };
  }

  async updatePartnerOrder(partnerId, orderId, body = {}) {
    if (!hasId(partnerId)) throw new ValidationException('Invalid partner');
    if (!hasId(orderId)) throw new ValidationException('Invalid order');
    const order = await StoreOrderModel.findOne({ _id: orderId, partnerId }).lean();
    if (!order) throw new NotFoundException('Order not found');
    if (order.payment?.status !== 'paid') {
      throw new ConflictException('This order has not been paid yet');
    }

    const nextStatus = text(body.status, 20);
    const allowed = {
      paid: ['processing'],
      processing: ['shipped'],
      shipped: ['delivered'],
    };
    if (!allowed[order.status]?.includes(nextStatus)) {
      throw new ConflictException(`Cannot move this order from ${order.status} to ${nextStatus}`);
    }

    const at = now();
    const settings = await this.getStoreSettings();
    const set = { status: nextStatus };
    if (nextStatus === 'processing') set.processingAt = at;
    if (nextStatus === 'shipped') set.shippedAt = at;
    if (nextStatus === 'delivered') {
      set.deliveredAt = at;
      set['escrow.releaseAt'] = new Date(at.getTime() + settings.escrowHoldDays * 24 * 60 * 60 * 1000);
    }
    for (const [key, max] of [
      ['courier', 120],
      ['trackingNumber', 120],
      ['trackingUrl', 500],
      ['note', 1000],
    ]) {
      if (body[key] !== undefined) set[`fulfilment.${key}`] = text(body[key], max);
    }

    const updated = await StoreOrderModel.findOneAndUpdate(
      { _id: orderId, partnerId, status: order.status },
      {
        $set: set,
        $push: {
          events: {
            type: `order_${nextStatus}`,
            at,
            note: nextStatus === 'delivered'
              ? 'Delivered; escrow release scheduled after the return window'
              : `Order marked ${nextStatus}`,
          },
        },
      },
      { new: true },
    ).lean();
    if (!updated) throw new ConflictException('Order status changed. Refresh and try again');
    return publicOrder(updated);
  }

  async cancelPendingOrder(orderId, note = 'Order cancelled') {
    if (!hasId(orderId)) return false;
    return runInTransaction(async (session) => {
      const opts = session ? { session } : {};
      const cancelled = await StoreOrderModel.findOneAndUpdate(
        { _id: orderId, status: 'pending_payment', stockReleased: false },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: now(),
            stockReleased: true,
            'payment.status': 'failed',
          },
          $push: { events: { type: 'order_cancelled', at: now(), note } },
        },
        { new: true, ...opts },
      ).lean();
      if (!cancelled) return false;

      for (const item of cancelled.items ?? []) {
        const quantity = Number(item.quantity) || 0;
        if (quantity <= 0) continue;
        await StoreProductModel.updateOne(
          { _id: item.storeProductId, partnerId: cancelled.partnerId },
          { $inc: { stock: quantity } },
          opts,
        );
        await StoreStockLedgerModel.create(
          [{
            partnerId: cancelled.partnerId,
            productId: item.productId,
            quantity,
            type: 'store_cancel',
            reference: cancelled.reference,
            note: 'Stock returned after an unpaid order',
          }],
          opts,
        );
      }
      return true;
    });
  }

  async expirePendingOrders() {
    const due = await StoreOrderModel.find({
      status: 'pending_payment',
      stockReleased: false,
      expiresAt: { $lte: now() },
    }).sort({ expiresAt: 1 }).limit(50).lean();
    let cancelled = 0;
    let paid = 0;
    let extended = 0;

    for (const order of due) {
      if (this.paystack?.enabled) {
        try {
          const live = await this.paystack.verify(order.reference);
          const status = lower(live?.status, 30);
          if (status === 'success') {
            if (Number(live?.amount) === Number(order.amounts?.totalKobo)) {
              await this.settleOrder(order, live);
              paid += 1;
              continue;
            }
          }
          if (terminalPaymentFailure.has(status)) {
            if (await this.cancelPendingOrder(order._id, 'Payment window expired')) cancelled += 1;
            continue;
          }
          await StoreOrderModel.updateOne(
            { _id: order._id, status: 'pending_payment' },
            { $set: { expiresAt: new Date(Date.now() + storeOrderTtlMinutes() * 60 * 1000) } },
          );
          extended += 1;
          continue;
        } catch (error) {
          console.error(`[store-orders] expiry check failed for ${order.reference}: ${error?.message ?? error}`);
          continue;
        }
      }
      if (await this.cancelPendingOrder(order._id, 'Payment window expired')) cancelled += 1;
    }
    return { checked: due.length, cancelled, paid, extended };
  }

  async releaseDueEscrows() {
    const due = await StoreOrderModel.find({
      status: 'delivered',
      'escrow.status': 'held',
      'escrow.releaseAt': { $lte: now() },
    }).sort({ 'escrow.releaseAt': 1 }).limit(50).lean();
    let released = 0;
    for (const order of due) {
      try {
        const result = await this.releaseOrder(order._id);
        if (result) released += 1;
      } catch (error) {
        console.error(`[store-orders] escrow release failed for ${order.reference}: ${error?.message ?? error}`);
      }
    }
    return { checked: due.length, released };
  }

  async releaseOrder(orderId, { force = false } = {}) {
    if (!hasId(orderId)) throw new ValidationException('Invalid order');
    return runInTransaction(async (session) => {
      const opts = session ? { session } : {};
      const at = now();
      const match = {
        _id: orderId,
        status: 'delivered',
        'escrow.status': 'held',
      };
      if (!force) match['escrow.releaseAt'] = { $lte: at };
      const claimed = await StoreOrderModel.findOneAndUpdate(
        match,
        {
          $set: {
            'escrow.status': 'released',
            'escrow.releasedAt': at,
            settledAt: at,
          },
          $push: {
            events: {
              type: 'escrow_released',
              at,
              note: 'Return window ended; earnings released to partner wallet',
            },
          },
        },
        { new: true, ...opts },
      ).lean();
      if (!claimed) return null;

      const amountKobo = Number(claimed.amounts?.partnerPendingKobo) || 0;
      if (amountKobo > 0) {
        await creditPartnerWallet(
          { partners: PartnersModel, transactions: TransactionModel },
          {
            partnerId: claimed.partnerId,
            amountNgn: fromKobo(amountKobo),
            paymentMethod: 'Store sale',
            reference: `STORE-${claimed.reference}`,
          },
          opts,
        );
      }
      await StoreEscrowLedgerModel.updateOne(
        { orderId: claimed._id, type: 'partner_pending' },
        { $set: { status: 'released', note: 'Released to partner wallet' } },
        opts,
      );
      await StoreEscrowLedgerModel.create(
        [{
          orderId: claimed._id,
          reference: claimed.reference,
          partnerId: claimed.partnerId,
          type: 'partner_release',
          amountKobo,
          note: 'Released to partner wallet after the return window',
        }],
        opts,
      );
      return {
        reference: claimed.reference,
        orderNumber: claimed.orderNumber,
        amount: fromKobo(amountKobo),
        currency: 'NGN',
      };
    });
  }

  /**
   * Refund a paid store order through Paystack and reverse its escrow/stock
   * effects. Restocking is automatic only while the order is still being
   * prepared; shipped/delivered refunds leave stock for the admin to adjust.
   */
  async refundOrder(orderId, { reason = '' } = {}) {
    if (!hasId(orderId)) throw new ValidationException('Invalid order');
    const cleanReason = text(reason, 500);
    if (cleanReason.length < 3) throw new ValidationException('Add a reason for the refund');

    const order = await StoreOrderModel.findById(orderId).lean();
    if (!order) throw new NotFoundException('Store order not found');
    if (order.status === 'refunded') return publicOrder(order);
    if (order.status === 'cancelled') throw new ConflictException('Cancelled orders cannot be refunded');
    if (order.payment?.status !== 'paid') throw new ConflictException('Only a paid order can be refunded');
    if (!this.paystack?.enabled) throw new ValidationException('Refunds are not available right now');

    const released = order.escrow?.status === 'released';
    const partnerPendingNgn = fromKobo(order.amounts?.partnerPendingKobo ?? 0);
    if (released) {
      const partner = await PartnersModel.findById(order.partnerId).select('balance').lean();
      if (!partner) throw new NotFoundException('Partner not found');
      if (Number(partner.balance ?? 0) < partnerPendingNgn) {
        throw new ConflictException(
          'Partner wallet balance is too low to recover this refund. Top up the partner wallet or process the refund manually.',
        );
      }
    }

    let providerRefund;
    try {
      providerRefund = await this.paystack.refund({
        reference: order.payment?.reference ?? order.reference,
        amountKobo: order.amounts?.totalKobo,
        reason: cleanReason,
      });
    } catch (error) {
      throw new ValidationException(`Could not refund with Paystack: ${error?.message ?? 'provider error'}`);
    }

    const at = now();
    const refundReference = providerRefund.reference || `REF-${order.reference}`;
    const result = await runInTransaction(async (session) => {
      const opts = session ? { session } : {};
      const claimed = await StoreOrderModel.findOneAndUpdate(
        { _id: orderId, status: { $ne: 'refunded' }, 'payment.status': 'paid' },
        {
          $set: {
            status: 'refunded',
            refundedAt: at,
            refundReference,
            refundReason: cleanReason,
            'payment.status': 'refunded',
            'escrow.status': 'refunded',
          },
          $push: {
            events: {
              type: 'order_refunded',
              at,
              note: `Refunded: ${cleanReason}`,
            },
          },
        },
        { new: true, ...opts },
      ).lean();
      if (!claimed) return { deduped: true };

      // Put stock back only while the order is still being prepared. A shipped
      // or delivered refund may be a partial return; the admin adjusts stock.
      if (['paid', 'processing'].includes(order.status) && !order.stockReleased) {
        for (const item of claimed.items ?? []) {
          const quantity = Number(item.quantity) || 0;
          if (quantity <= 0) continue;
          await StoreProductModel.updateOne(
            { _id: item.storeProductId, partnerId: claimed.partnerId },
            { $inc: { stock: quantity, soldCount: -quantity } },
            opts,
          );
          await StoreInventoryModel.updateOne(
            { partnerId: claimed.partnerId, productId: item.productId },
            { $inc: { quantity } },
            opts,
          );
          await StoreStockLedgerModel.create(
            [{
              partnerId: claimed.partnerId,
              productId: item.productId,
              quantity,
              type: 'store_cancel',
              reference: claimed.reference,
              note: 'Stock returned after a refund',
            }],
            opts,
          );
        }
        await StoreOrderModel.updateOne(
          { _id: claimed._id },
          { $set: { stockReleased: true } },
          opts,
        );
      }

      await StoreEscrowLedgerModel.updateOne(
        { orderId: claimed._id, type: 'partner_pending', status: 'posted' },
        { $set: { status: 'void', note: 'Voided by refund' } },
        opts,
      );
      await StoreEscrowLedgerModel.create(
        [{
          orderId: claimed._id,
          reference: claimed.reference,
          partnerId: claimed.partnerId,
          type: 'refund',
          amountKobo: -Number(claimed.amounts?.totalKobo ?? 0),
          note: `Refunded: ${cleanReason}`,
        }],
        opts,
      );

      if (released && partnerPendingNgn > 0) {
        const debited = await PartnersModel.findByIdAndUpdate(
          claimed.partnerId,
          { $inc: { balance: -partnerPendingNgn } },
          { new: true, ...opts },
        );
        if (!debited) throw new NotFoundException('Partner not found');
        await TransactionModel.create(
          [{
            partnerId: claimed.partnerId,
            amount: -partnerPendingNgn,
            status: 'Completed',
            paymentMethod: 'Store refund',
            transactionType: 'Debit',
            reference: `STORE-REFUND-${claimed.reference}`,
          }],
          opts,
        );
      }

      return { deduped: false, order: claimed };
    });

    if (result.deduped) {
      const fresh = await StoreOrderModel.findById(orderId).lean();
      return publicOrder(fresh);
    }

    void this.events?.emit?.(STORE_EVENTS.ORDER_REFUNDED, {
      orderId: String(result.order._id),
      partnerId: String(result.order.partnerId),
      reference: result.order.reference,
      orderNumber: result.order.orderNumber,
      customerName: result.order.customer?.name ?? 'A customer',
      customerEmail: result.order.customer?.email ?? '',
      total: fromKobo(result.order.amounts?.totalKobo),
      currency: 'NGN',
      reason: cleanReason,
      refundReference,
    });

    return publicOrder(result.order);
  }

  async listAllOrders({ status, q, storeId, partnerId, limit = 100 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (storeId && hasId(storeId)) filter.storeId = new mongoose.Types.ObjectId(storeId);
    if (partnerId && hasId(partnerId)) filter.partnerId = new mongoose.Types.ObjectId(partnerId);
    const query = text(q, 120);
    if (query) {
      const regex = new RegExp(escapeRegex(query), 'i');
      filter.$or = [
        { orderNumber: regex },
        { reference: regex },
        { storeName: regex },
        { storeSlug: regex },
        { 'customer.name': regex },
        { 'customer.email': regex },
        { 'customer.phone': regex },
      ];
    }
    const orders = await StoreOrderModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 200))
      .lean();
    return orders.map(publicOrder);
  }

  async getAdminOrder(orderId) {
    if (!hasId(orderId)) throw new ValidationException('Invalid order');
    const order = await StoreOrderModel.findById(orderId).lean();
    if (!order) throw new NotFoundException('Store order not found');
    return publicOrder(order);
  }

  async getAdminSettlements() {
    const [held, released, paid, awaiting] = await Promise.all([
      StoreOrderModel.aggregate([
        { $match: { 'escrow.status': 'held' } },
        {
          $group: {
            _id: null,
            amountKobo: { $sum: '$amounts.partnerPendingKobo' },
            count: { $sum: 1 },
          },
        },
      ]),
      StoreOrderModel.aggregate([
        { $match: { 'escrow.status': 'released' } },
        {
          $group: {
            _id: null,
            amountKobo: { $sum: '$amounts.partnerPendingKobo' },
            count: { $sum: 1 },
          },
        },
      ]),
      StoreOrderModel.aggregate([
        { $match: { 'payment.status': 'paid' } },
        {
          $group: {
            _id: null,
            serviceFeeKobo: { $sum: '$amounts.serviceFeeKobo' },
            paymentFeeKobo: { $sum: '$amounts.paymentFeeKobo' },
          },
        },
      ]),
      StoreOrderModel.countDocuments({ status: 'delivered', 'escrow.status': 'held' }),
    ]);
    const settings = await this.getStoreSettings();
    return {
      heldAmount: fromKobo(held[0]?.amountKobo),
      releasedAmount: fromKobo(released[0]?.amountKobo),
      serviceFees: fromKobo(paid[0]?.serviceFeeKobo),
      paymentFees: fromKobo(paid[0]?.paymentFeeKobo),
      heldOrders: Number(held[0]?.count) || 0,
      releasedOrders: Number(released[0]?.count) || 0,
      deliveredAwaitingRelease: Number(awaiting) || 0,
      escrowHoldDays: settings.escrowHoldDays,
      currency: 'NGN',
    };
  }

  async handleWebhook({ payload, rawBody, signature }) {
    if (!verifyPaystackSignature(rawBody, signature, this.paystack?.secretKey)) {
      const error = new Error('Invalid Paystack webhook signature');
      error.code = 'BAD_SIGNATURE';
      throw error;
    }
    const event = String(payload?.event ?? '');
    if (event !== 'charge.success') return { handled: false, event };
    const data = payload?.data ?? {};
    const reference = text(data.reference, 80);
    if (!reference) return { handled: false, event };
    const order = await StoreOrderModel.findOne({ reference }).lean();
    if (!order) return { handled: false, event, reference };
    if (order.payment?.status === 'paid') {
      return { handled: true, status: 'paid', reference, deduped: true, orderNumber: order.orderNumber };
    }
    if (order.status === 'cancelled') {
      console.error(`[store-orders] payment arrived for cancelled order ${reference}`);
      return { handled: true, status: 'cancelled', reference, needsRefund: true };
    }

    const live = await this.paystack.verify(reference);
    if (lower(live?.status, 30) !== 'success') {
      return { handled: true, status: lower(live?.status, 30) || 'pending', reference };
    }
    if (Number(live?.amount) !== Number(order.amounts?.totalKobo)) {
      const error = new Error('Paystack amount does not match the store order');
      error.code = 'AMOUNT_MISMATCH';
      throw error;
    }
    if (String(live?.currency ?? 'NGN').toUpperCase() !== 'NGN') {
      const error = new Error('Paystack currency does not match the store order');
      error.code = 'AMOUNT_MISMATCH';
      throw error;
    }
    const settled = await this.settleOrder(order, live);
    return {
      handled: true,
      status: 'paid',
      reference,
      orderNumber: order.orderNumber,
      deduped: settled.deduped === true,
    };
  }

  /** Alias used by the unified billing webhook. */
  async execute(payload) {
    return this.handleWebhook(payload);
  }
}
