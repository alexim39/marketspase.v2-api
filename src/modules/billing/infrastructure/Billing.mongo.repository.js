import mongoose from 'mongoose';
import { CartModel, PartnersModel } from './Billing.models.js';

const oid = (v) => String(v);
const objectId = (v) => new mongoose.Types.ObjectId(v);

/**
 * Read-only product-order/cart metrics used by dashboards, goals, progression
 * and reporting. The legacy cart commission ledger was retired; this class
 * deliberately contains no commission accrual or release logic.
 */
export class MongoOrderReader {
  async findCart(cartId) {
    const cart = await CartModel.findById(cartId).lean();
    if (!cart) return null;
    const buyer = await PartnersModel.findById(cart.partner).select('username name surname').lean();
    return {
      id: oid(cart._id),
      buyerId: cart.partner ? oid(cart.partner) : null,
      buyerUsername: buyer?.username ?? '',
      buyerName: `${buyer?.name ?? ''} ${buyer?.surname ?? ''}`.trim(),
      total: cart.totalCost,
      status: cart.orderStatus ?? 'Pending',
      commissionPlan: cart.commissionPlan ?? 'legacy',
    };
  }

  async markCart(cartId, status) {
    return CartModel.findByIdAndUpdate(cartId, { orderStatus: status }, { new: true }).lean();
  }

  async personalVolume(partnerId) {
    const rows = await CartModel.aggregate([
      { $match: { partner: objectId(partnerId), orderStatus: { $ne: 'Voided' } } },
      { $group: { _id: null, total: { $sum: '$totalCost' }, orders: { $sum: 1 } } },
    ]);
    return { total: rows[0]?.total ?? 0, orders: rows[0]?.orders ?? 0 };
  }

  async volumeFor(partnerIds) {
    if (partnerIds.length === 0) return { total: 0, orders: 0 };
    const ids = partnerIds.map(objectId);
    const rows = await CartModel.aggregate([
      { $match: { partner: { $in: ids }, orderStatus: { $ne: 'Voided' } } },
      { $group: { _id: null, total: { $sum: '$totalCost' }, orders: { $sum: 1 } } },
    ]);
    return { total: rows[0]?.total ?? 0, orders: rows[0]?.orders ?? 0 };
  }

  /** Windowed volume for goal progress (single partner). */
  async volumeBetween(partnerId, start, end) {
    const rows = await CartModel.aggregate([
      {
        $match: {
          partner: objectId(partnerId),
          orderStatus: { $ne: 'Voided' },
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalCost' }, orders: { $sum: 1 } } },
    ]);
    return { total: rows[0]?.total ?? 0, orders: rows[0]?.orders ?? 0 };
  }

  /** Windowed volume over an explicit id set (bounded team set). */
  async volumeForBetween(partnerIds, start, end) {
    if (partnerIds.length === 0) return { total: 0, orders: 0 };
    const ids = partnerIds.map(objectId);
    const rows = await CartModel.aggregate([
      {
        $match: {
          partner: { $in: ids },
          orderStatus: { $ne: 'Voided' },
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalCost' }, orders: { $sum: 1 } } },
    ]);
    return { total: rows[0]?.total ?? 0, orders: rows[0]?.orders ?? 0 };
  }

  /** Monthly personal-volume buckets (oldest → newest) for trend charts. */
  async volumeByMonth(partnerId, months = 6) {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    start.setMonth(start.getMonth() - (months - 1));
    const rows = await CartModel.aggregate([
      {
        $match: {
          partner: objectId(partnerId),
          orderStatus: { $ne: 'Voided' },
          createdAt: { $gte: start },
        },
      },
      {
        $group: {
          _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
          total: { $sum: '$totalCost' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]);
    const buckets = [];
    const cursor = new Date(start);
    for (let i = 0; i < months; i++) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth() + 1;
      const found = rows.find((r) => r._id.y === y && r._id.m === m);
      buckets.push({
        label: cursor.toLocaleString('en', { month: 'short' }),
        total: found?.total ?? 0,
        orders: found?.orders ?? 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
  }

  async recruitsSince(partnerId, since) {
    return PartnersModel.countDocuments({
      partnerOf: partnerId,
      placementCampaignId: null,
      createdAt: { $gte: since },
    });
  }

  /** Personal recruits within a closed window (goal/progression progress). */
  async recruitsBetween(partnerId, start, end) {
    return PartnersModel.countDocuments({
      partnerOf: partnerId,
      placementCampaignId: null,
      createdAt: { $gte: start, $lte: end },
    });
  }

  /** Team activation: distinct members with a non-voided order in-window. */
  async activeMemberCount(partnerIds, start, end) {
    if (partnerIds.length === 0) return 0;
    const ids = partnerIds.map(objectId);
    const rows = await CartModel.aggregate([
      {
        $match: {
          partner: { $in: ids },
          orderStatus: { $ne: 'Voided' },
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: '$partner' } },
      { $count: 'active' },
    ]);
    return rows[0]?.active ?? 0;
  }
}
