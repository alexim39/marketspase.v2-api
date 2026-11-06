import { STORE_EVENTS } from '../../stores/domain/StoreEvents.js';

/** Notify a partner when a customer payment settles into escrow. */
export class StoreOrderFanoutUseCase {
  constructor({ delivery, partners }) {
    Object.assign(this, { delivery, partners });
  }

  async notifyPaid({ partnerId, orderId, orderNumber, customerName, total, currency = 'NGN' }) {
    try {
      const partner = await this.partners.findById(partnerId).catch(() => null);
      const customer = String(customerName ?? '').trim() || 'A customer';
      const amount = Number(total ?? 0).toLocaleString('en-NG');
      const report = await this.delivery.deliver({
        recipientId: partnerId,
        contact: { email: partner?.email ?? null, phone: partner?.phone ?? null },
        item: {
          category: 'system',
          priority: 'high',
          title: `New paid store order ${orderNumber}`,
          body: `${customer} paid ${currency} ${amount}. Start processing, add tracking and mark delivery to release escrow.`,
          icon: 'shopping_bag',
          link: '/dashboard/products/store-orders',
          key: `store-order-paid:${orderId}`,
        },
      });
      return report.inApp === 'created' || report.inApp === 'deduped'
        ? { status: 'notified', deduped: report.inApp === 'deduped' }
        : { status: 'skipped', report };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }
}

/** @returns unsubscribe function */
export const subscribeStoreOrderFanout = ({ events, delivery, partners }) => {
  const fanout = new StoreOrderFanoutUseCase({ delivery, partners });
  return events.on(STORE_EVENTS.ORDER_PAID, (payload) => fanout.notifyPaid(payload));
};
