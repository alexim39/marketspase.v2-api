import { StoreCustomerLeadModel, StoreOrderModel } from '../../stores/infrastructure/Store.models.js';

const clampDays = (days) => Math.min(Math.max(Number(days) || 90, 30), 365);
const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/**
 * Read-only recurring-revenue evaluation. It does not create subscriptions;
 * it measures whether repeat demand is strong enough to justify bundles,
 * repeat-order plans or subscriptions.
 */
export class GetRecurringRevenueUseCase {
  constructor({
    leads = StoreCustomerLeadModel,
    orders = StoreOrderModel,
  } = {}) {
    Object.assign(this, { leads, orders });
  }

  async execute({ days = 90, now = new Date() } = {}) {
    const windowDays = clampDays(days);
    const since = new Date(new Date(now).getTime() - windowDays * 86400000);
    const dormantBefore = new Date(new Date(now).getTime() - 60 * 86400000);

    const [leadRows, orderRows, repeatProducts] = await Promise.all([
      this.leads.aggregate([
        { $match: { firstSeenAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            customers: { $sum: 1 },
            repeatCustomers: { $sum: { $cond: [{ $gte: ['$paidOrders', 2] }, 1, 0] } },
            loyalCustomers: { $sum: { $cond: [{ $gte: ['$paidOrders', 3] }, 1, 0] } },
            dormant: {
              $sum: {
                $cond: [
                  { $and: [{ $gte: ['$paidOrders', 1] }, { $lte: ['$lastPaidAt', dormantBefore] }] },
                  1,
                  0,
                ],
              },
            },
            orders: { $sum: '$paidOrders' },
            revenueKobo: { $sum: '$totalSpentKobo' },
            repeatRevenueKobo: {
              $sum: {
                $cond: [{ $gte: ['$paidOrders', 2] }, '$totalSpentKobo', 0],
              },
            },
          },
        },
      ]).catch(() => []),
      this.orders.aggregate([
        { $match: { status: { $in: ['paid', 'processing', 'shipped', 'delivered'] }, createdAt: { $gte: since } } },
        { $group: { _id: null, orders: { $sum: 1 }, revenueKobo: { $sum: '$amounts.totalKobo' } } },
      ]).catch(() => []),
      this.orders.aggregate([
        { $match: { status: { $in: ['paid', 'processing', 'shipped', 'delivered'] }, createdAt: { $gte: since } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.name',
            units: { $sum: '$items.quantity' },
            orders: { $addToSet: '$customer.phone' },
          },
        },
        { $project: { _id: 0, name: '$_id', units: 1, buyers: { $size: '$orders' } } },
        { $sort: { buyers: -1, units: -1 } },
        { $limit: 8 },
      ]).catch(() => []),
    ]);

    const lead = leadRows?.[0] ?? {};
    const customers = Number(lead.customers ?? 0);
    const repeatCustomers = Number(lead.repeatCustomers ?? 0);
    const orders = Number(lead.orders ?? 0);
    const repeatRate = rate(repeatCustomers, customers);
    const repeatRevenue = Math.round(Number(lead.repeatRevenueKobo ?? 0) / 100);
    const revenue = Math.round(Number(lead.revenueKobo ?? 0) / 100);
    const avgOrders = customers > 0 ? Math.round((orders / customers) * 10) / 10 : 0;

    let recommendation = 'Build first-purchase confidence before adding recurring plans.';
    if ((repeatRate ?? 0) >= 35 && repeatCustomers >= 10) {
      recommendation = 'Repeat demand is strong: test a repeat-order plan or subscription on the top repeat products.';
    } else if ((repeatRate ?? 0) >= 20 || repeatCustomers >= 5) {
      recommendation = 'Start with bundles and reorder reminders; move to subscriptions once repeat rate is consistently above 35%.';
    }

    return {
      days: windowDays,
      generatedAt: new Date().toISOString(),
      customers,
      repeatCustomers,
      loyalCustomers: Number(lead.loyalCustomers ?? 0),
      dormantCustomers: Number(lead.dormant ?? 0),
      orders,
      avgOrdersPerCustomer: avgOrders,
      repeatRate,
      revenue,
      repeatCustomerRevenue: repeatRevenue,
      repeatRevenueShare: rate(repeatRevenue, revenue),
      paidOrderCount: Number(orderRows?.[0]?.orders ?? 0),
      topRepeatProducts: (repeatProducts ?? []).map((row) => ({
        name: row.name || 'Unnamed product',
        units: Number(row.units ?? 0),
        buyers: Number(row.buyers ?? 0),
      })),
      recommendation,
    };
  }
}
