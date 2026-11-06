import { CartModel, ProductModel } from '../../../apps/product/models/product.model.js';
import { PRODUCT_PAYMENT_FEE_RATE } from '../domain/ProductCommission.js';
import {
  GrowthCommissionModel,
  ProductCommissionSaleModel,
} from './Compensation.models.js';
import { MongoCompensationRepository } from './Compensation.mongo.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_CAP = 5000;
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

const parseRange = ({ from, to } = {}) => {
  const end = to ? new Date(to) : new Date();
  const safeEnd = Number.isNaN(end.getTime()) ? new Date() : end;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(to ?? ''))) {
    safeEnd.setHours(23, 59, 59, 999);
  }
  const start = from ? new Date(from) : new Date(safeEnd.getTime() - (90 * DAY_MS));
  const safeStart = Number.isNaN(start.getTime())
    ? new Date(safeEnd.getTime() - (90 * DAY_MS))
    : start;
  return { from: safeStart, to: safeEnd };
};

const totals = () => ({
  orders: 0,
  revenue: 0,
  grossMargin: 0,
  commissionableMargin: 0,
  released: 0,
  pending: 0,
  voided: 0,
  reversed: 0,
});

const addTotals = (target, source) => {
  target.orders += source.orders;
  target.revenue += source.revenue;
  target.grossMargin += source.grossMargin;
  target.commissionableMargin += source.commissionableMargin;
  target.released += source.released;
  target.pending += source.pending;
  target.voided += source.voided;
  target.reversed += source.reversed;
};

const lineMargin = (item) => {
  const price = Math.max(Number(item.price) || 0, 0);
  const quantity = Math.max(Number(item.quantity) || 0, 0);
  const cogs = Math.max(Number(item.cogs) || 0, 0);
  const shipping = Math.max(Number(item.shippingCost) || 0, 0);
  const gross = price * quantity;
  const fee = gross * PRODUCT_PAYMENT_FEE_RATE;
  return round(Math.max(gross - (cogs * quantity) - (shipping * quantity) - fee, 0));
};

export class ProductCommissionReporting {
  constructor({ repo } = {}) {
    this.repo = repo ?? new MongoCompensationRepository();
  }

  async report({ from, to } = {}) {
    const range = parseRange({ from, to });
    const carts = await CartModel.find({
      commissionPlan: 'growth',
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .select('orderNumber orderStatus totalCost grossMargin commissionableMargin saleMode products createdAt')
      .sort({ createdAt: -1 })
      .limit(REPORT_CAP)
      .lean();

    const cartIds = carts.map((cart) => cart._id);
    const sales = cartIds.length
      ? await ProductCommissionSaleModel.find({ cartId: { $in: cartIds } }).lean()
      : [];
    const saleByCart = new Map(sales.map((sale) => [String(sale.cartId), sale]));

    const saleIds = sales.map((sale) => sale._id);
    const entries = saleIds.length
      ? await GrowthCommissionModel.find({ saleId: { $in: saleIds } })
        .select('saleId amount status')
        .lean()
      : [];
    const entriesBySale = new Map();
    for (const entry of entries) {
      const key = String(entry.saleId);
      const list = entriesBySale.get(key) ?? [];
      list.push(entry);
      entriesBySale.set(key, list);
    }

    const productIds = [...new Set(
      carts.flatMap((cart) => (cart.products ?? []).map((item) => String(item.product))),
    )];
    const products = productIds.length
      ? await ProductModel.find({ _id: { $in: productIds } }).select('name').lean()
      : [];
    const productNames = new Map(products.map((product) => [String(product._id), product.name ?? 'Product']));

    const summary = totals();
    const bySaleMode = new Map();
    const byProduct = new Map();
    const problems = [];
    const problemCounts = {
      missing_accrual: 0,
      fulfilled_not_released: 0,
      cancelled_not_voided: 0,
    };

    for (const cart of carts) {
      const sale = saleByCart.get(String(cart._id));
      const cartEntries = sale ? entriesBySale.get(String(sale._id)) ?? [] : [];
      const released = cartEntries
        .filter((entry) => entry.status === 'Released')
        .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
      const pending = cartEntries
        .filter((entry) => entry.status === 'Pending')
        .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
      const voided = cartEntries
        .filter((entry) => entry.status === 'Voided')
        .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
      const reversed = cartEntries
        .filter((entry) => entry.status === 'Reversed')
        .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);

      const cartTotals = {
        orders: 1,
        revenue: Number(cart.totalCost) || 0,
        grossMargin: Number(cart.grossMargin) || 0,
        commissionableMargin: Number(cart.commissionableMargin) || 0,
        released,
        pending,
        voided,
        reversed,
      };
      addTotals(summary, cartTotals);

      const mode = cart.saleMode ?? 'personal';
      const modeTotals = bySaleMode.get(mode) ?? { mode, ...totals() };
      addTotals(modeTotals, cartTotals);
      bySaleMode.set(mode, modeTotals);

      const commissionable = cartTotals.commissionableMargin;
      const share = (amount) => (
        commissionable > 0 && amount > 0 ? amount / commissionable : 0
      );
      const releasedShare = share(released);
      const pendingShare = share(pending);

      for (const item of cart.products ?? []) {
        const id = String(item.product);
        const row = byProduct.get(id) ?? {
          productId: id,
          name: productNames.get(id) ?? 'Product',
          units: 0,
          revenue: 0,
          grossMargin: 0,
          commissionableMargin: 0,
          released: 0,
          pending: 0,
        };
        const margin = lineMargin(item);
        const lineCommissionable = item.commissionable === true ? margin : 0;
        row.units += Number(item.quantity) || 0;
        row.revenue += (Number(item.price) || 0) * (Number(item.quantity) || 0);
        row.grossMargin += margin;
        row.commissionableMargin += lineCommissionable;
        row.released += lineCommissionable * releasedShare;
        row.pending += lineCommissionable * pendingShare;
        byProduct.set(id, row);
      }

      const status = cart.orderStatus ?? 'Pending';
      const saleStatus = sale?.status ?? 'missing';
      const entryCount = cartEntries.length;
      const pendingCount = cartEntries.filter((entry) => entry.status === 'Pending').length;

      if (!sale && (status === 'Pending' || status === 'Fulfilled')) {
        problemCounts.missing_accrual += 1;
        if (problems.length < 100) {
          problems.push({
            kind: 'missing_accrual',
            severity: 'error',
            orderNumber: cart.orderNumber ?? '',
            cartId: String(cart._id),
            orderStatus: status,
            saleStatus,
            totalCost: Number(cart.totalCost) || 0,
            grossMargin: Number(cart.grossMargin) || 0,
            commissionableMargin: Number(cart.commissionableMargin) || 0,
            entryCount,
            pendingCount,
            createdAt: cart.createdAt,
          });
        }
      } else if (status === 'Fulfilled' && saleStatus !== 'released') {
        problemCounts.fulfilled_not_released += 1;
        if (problems.length < 100) {
          problems.push({
            kind: 'fulfilled_not_released',
            severity: 'error',
            orderNumber: cart.orderNumber ?? '',
            cartId: String(cart._id),
            orderStatus: status,
            saleStatus,
            totalCost: Number(cart.totalCost) || 0,
            grossMargin: Number(cart.grossMargin) || 0,
            commissionableMargin: Number(cart.commissionableMargin) || 0,
            entryCount,
            pendingCount,
            createdAt: cart.createdAt,
          });
        }
      }

      if (status === 'Cancelled' && sale && saleStatus !== 'voided') {
        problemCounts.cancelled_not_voided += 1;
        if (problems.length < 100) {
          problems.push({
            kind: 'cancelled_not_voided',
            severity: 'error',
            orderNumber: cart.orderNumber ?? '',
            cartId: String(cart._id),
            orderStatus: status,
            saleStatus,
            totalCost: Number(cart.totalCost) || 0,
            grossMargin: Number(cart.grossMargin) || 0,
            commissionableMargin: Number(cart.commissionableMargin) || 0,
            entryCount,
            pendingCount,
            createdAt: cart.createdAt,
          });
        }
      }
    }

    const summaryOut = {
      ...summary,
      revenue: round(summary.revenue),
      grossMargin: round(summary.grossMargin),
      commissionableMargin: round(summary.commissionableMargin),
      released: round(summary.released),
      pending: round(summary.pending),
      voided: round(summary.voided),
      reversed: round(summary.reversed),
      platformRetained: round(summary.grossMargin - summary.released),
      releasedRate: summary.commissionableMargin > 0
        ? round((summary.released / summary.commissionableMargin) * 100)
        : 0,
      pendingRate: summary.commissionableMargin > 0
        ? round((summary.pending / summary.commissionableMargin) * 100)
        : 0,
    };

    const byMode = [...bySaleMode.values()]
      .map((row) => ({
        ...row,
        revenue: round(row.revenue),
        grossMargin: round(row.grossMargin),
        commissionableMargin: round(row.commissionableMargin),
        released: round(row.released),
        pending: round(row.pending),
        voided: round(row.voided),
        reversed: round(row.reversed),
      }))
      .sort((a, b) => a.mode.localeCompare(b.mode));

    const byProductOut = [...byProduct.values()]
      .map((row) => ({
        ...row,
        revenue: round(row.revenue),
        grossMargin: round(row.grossMargin),
        commissionableMargin: round(row.commissionableMargin),
        released: round(row.released),
        pending: round(row.pending),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 100);

    return {
      range,
      summary: summaryOut,
      bySaleMode: byMode,
      byProduct: byProductOut,
      problems,
      problemCounts,
      meta: {
        orders: carts.length,
        truncated: carts.length === REPORT_CAP,
        generatedAt: new Date(),
      },
    };
  }

  /**
   * Repair missing product-commission accruals only. Never releases or voids
   * an entry; those stay explicit admin decisions.
   */
  async reconcile({ from, to, limit = 100, apply = false } = {}) {
    const range = parseRange({ from, to });
    const size = Math.min(Math.max(Number(limit) || 100, 1), 500);

    const carts = await CartModel.find({
      commissionPlan: 'growth',
      orderStatus: { $in: ['Pending', 'Fulfilled'] },
      createdAt: { $gte: range.from, $lte: range.to },
    })
      .select('_id orderNumber orderStatus totalCost createdAt')
      .sort({ createdAt: 1 })
      .limit(REPORT_CAP)
      .lean();

    const cartIds = carts.map((cart) => cart._id);
    const existing = cartIds.length
      ? await ProductCommissionSaleModel.find({ cartId: { $in: cartIds } })
        .select('cartId')
        .lean()
      : [];
    const existingIds = new Set(existing.map((sale) => String(sale.cartId)));
    const allMissing = carts.filter((cart) => !existingIds.has(String(cart._id)));
    const missing = allMissing.slice(0, size);

    const failures = [];
    let repaired = 0;

    if (apply) {
      for (const cart of missing) {
        try {
          await this.repo.accrueProductSale(cart._id);
          repaired += 1;
        } catch (error) {
          failures.push({
            cartId: String(cart._id),
            orderNumber: cart.orderNumber ?? '',
            message: error?.message ?? 'Accrual failed',
          });
        }
      }
    }

    return {
      range,
      dryRun: !apply,
      scanned: carts.length,
      missing: missing.length,
      missingTotal: allMissing.length,
      repaired,
      failed: failures.length,
      failures: failures.slice(0, 20),
      samples: missing.slice(0, 20).map((cart) => ({
        cartId: String(cart._id),
        orderNumber: cart.orderNumber ?? '',
        orderStatus: cart.orderStatus ?? 'Pending',
        totalCost: Number(cart.totalCost) || 0,
        createdAt: cart.createdAt,
      })),
    };
  }
}
