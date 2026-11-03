import mongoose from 'mongoose';
import {
  CartModel, CommissionModel, CommissionPlanModel, PartnersModel, TransactionModel, runInTransaction,
} from './Billing.models.js';
import { DEFAULT_RATES } from '../domain/CommissionPlan.js';

const oid = (v) => String(v);
const objectId = (v) => new mongoose.Types.ObjectId(v);

/** Mongo implementation of the billing contracts. */
export class MongoCommissionLedger {
  async getActivePlan() {
    const existing = await CommissionPlanModel.findOne({ active: true }).lean();
    if (existing) return existing;
    return CommissionPlanModel.create({ name: 'Default Unilevel', rates: DEFAULT_RATES, active: true });
  }

  /**
   * Plan rotation — deactivates every active row, activates the new one.
   * Old rows stay for dispute time-travel; accrues always read active.
   */
  async rotatePlan({ name, rates, updatedBy = null }) {
    await CommissionPlanModel.updateMany({ active: true }, { $set: { active: false } });
    const doc = await CommissionPlanModel.create({
      name, rates, active: true, ...(updatedBy ? { updatedBy } : {}),
    });
    return doc.toObject();
  }

  async findByCart(cartId) {
    return CommissionModel.find({ cartId }).lean();
  }

  async insertMany(entries) {
    if (entries.length === 0) return [];
    return CommissionModel.insertMany(entries, { ordered: false });
  }

  async findByEarner(partnerId, { limit = 50, skip = 0, status } = {}) {
    const filter = { earnerId: partnerId };
    if (status) filter.status = status;
    const [items, total] = await Promise.all([
      CommissionModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CommissionModel.countDocuments(filter),
    ]);
    return { items: items.map((d) => ({ ...d, id: oid(d._id) })), total };
  }

  /** Recent releases for the notification feed (bounded lookback). */
  async findReleasedSince(partnerId, lookbackDays = 30) {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const docs = await CommissionModel.find({
      earnerId: partnerId,
      status: 'Released',
      $or: [{ releasedAt: { $gte: since } }, { releasedAt: null, createdAt: { $gte: since } }],
    })
      .sort({ releasedAt: -1, createdAt: -1 })
      .limit(20)
      .lean();
    return docs.map((d) => ({ ...d, id: oid(d._id) }));
  }

  async sumByEarner(partnerId) {
    const rows = await CommissionModel.aggregate([
      { $match: { earnerId: objectId(partnerId) } },
      { $group: { _id: '$status', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const out = { Pending: 0, Released: 0, Voided: 0, Reversed: 0, pendingCount: 0, releasedCount: 0 };
    for (const r of rows) {
      if (r._id in out) out[r._id] = Math.round(r.total * 100) / 100;
      if (r._id === 'Pending') out.pendingCount = r.count;
      if (r._id === 'Released') out.releasedCount = r.count;
    }
    out.lifetime = Math.round((out.Released) * 100) / 100;
    return out;
  }

  /** Monthly released-earnings buckets (oldest → newest) for trend charts. */
  async releasedByMonth(partnerId, months = 6) {
    const m = Math.min(Math.max(Number(months) || 6, 2), 12);
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    start.setMonth(start.getMonth() - (m - 1));
    const rows = await CommissionModel.aggregate([
      {
        $match: {
          earnerId: objectId(partnerId),
          status: 'Released',
          $or: [{ releasedAt: { $gte: start } }, { releasedAt: null, createdAt: { $gte: start } }],
        },
      },
      {
        $group: {
          _id: {
            y: { $year: { $ifNull: ['$releasedAt', '$createdAt'] } },
            m: { $month: { $ifNull: ['$releasedAt', '$createdAt'] } },
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]);
    const buckets = [];
    const cursor = new Date(start);
    for (let i = 0; i < m; i++) {
      const y = cursor.getFullYear();
      const mon = cursor.getMonth() + 1;
      const found = rows.find((r) => r._id.y === y && r._id.m === mon);
      buckets.push({
        label: cursor.toLocaleString('en', { month: 'short' }),
        total: Math.round((found?.total ?? 0) * 100) / 100,
        count: found?.count ?? 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return { months: m, buckets };
  }

  async pendingCarts({ limit = 25, skip = 0 } = {}) {
    const rows = await CommissionModel.aggregate([
      { $match: { status: 'Pending' } },
      { $group: { _id: '$cartId', total: { $sum: '$amount' }, count: { $sum: 1 }, latest: { $max: '$createdAt' }, buyerUsername: { $first: '$buyerUsername' }, buyerName: { $first: '$buyerName' } } },
      { $sort: { latest: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);
    const totalGroups = await CommissionModel.aggregate([
      { $match: { status: 'Pending' } },
      { $group: { _id: '$cartId' } },
      { $count: 'n' },
    ]);
    return {
      items: rows.map((r) => ({ cartId: oid(r._id), total: Math.round(r.total * 100) / 100, entries: r.count, buyerUsername: r.buyerUsername, buyerName: r.buyerName, latest: r.latest })),
      total: totalGroups[0]?.n ?? 0,
    };
  }

  async releaseCart(cartId, { releasedBy }) {
    return runInTransaction(async (session) => {
      const opt = session ? { session } : {};
      const pending = await CommissionModel.find({ cartId, status: 'Pending' }).setOptions(opt);
      let total = 0;
      for (const entry of pending) {
        entry.status = 'Released';
        entry.releasedBy = releasedBy;
        entry.releasedAt = new Date();
        await entry.save(opt);
        await PartnersModel.findByIdAndUpdate(entry.earnerId, { $inc: { balance: entry.amount } }, opt);
        await TransactionModel.create([{
          partnerId: entry.earnerId,
          amount: entry.amount,
          status: 'Completed',
          paymentMethod: 'Commission',
          transactionType: 'Credit',
          reference: `COMM-${oid(entry._id)}`,
        }], opt);
        total = Math.round((total + entry.amount) * 100) / 100;
      }
      return { released: pending.length, total };
    });
  }

  async voidCart(cartId, { releasedBy }) {
    return runInTransaction(async (session) => {
      const opt = session ? { session } : {};
      const entries = await CommissionModel.find({ cartId, status: { $in: ['Pending', 'Released'] } }).setOptions(opt);
      let voided = 0;
      let reversed = 0;
      for (const entry of entries) {
        if (entry.status === 'Pending') {
          entry.status = 'Voided';
          await entry.save(opt);
          voided += 1;
        } else {
          entry.status = 'Reversed';
          await entry.save(opt);
          await PartnersModel.findByIdAndUpdate(entry.earnerId, { $inc: { balance: -entry.amount } }, opt);
          await TransactionModel.create([{
            partnerId: entry.earnerId,
            amount: entry.amount,
            status: 'Completed',
            paymentMethod: 'Commission Clawback',
            transactionType: 'Debit',
            reference: `CLAW-${oid(entry._id)}`,
          }], opt);
          reversed += 1;
        }
      }
      return { voided, reversed, releasedBy };
    });
  }
}

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
    return PartnersModel.countDocuments({ partnerOf: partnerId, createdAt: { $gte: since } });
  }

  /** Recruits within a closed window (goal progress). */
  async recruitsBetween(partnerId, start, end) {
    return PartnersModel.countDocuments({ partnerOf: partnerId, createdAt: { $gte: start, $lte: end } });
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
