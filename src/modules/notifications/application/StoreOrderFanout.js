import { STORE_EVENTS } from '../../stores/domain/StoreEvents.js';

/** Notify a partner when a customer payment settles into escrow. */
export class StoreOrderFanoutUseCase {
  constructor({ delivery, partners, mail = null }) {
    Object.assign(this, { delivery, partners, mail });
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

  async notifyRefunded({
    partnerId,
    orderId,
    orderNumber,
    customerName,
    customerEmail,
    total,
    currency = 'NGN',
    reason = '',
    refundReference = '',
  }) {
    try {
      const partner = await this.partners.findById(partnerId).catch(() => null);
      const customer = String(customerName ?? '').trim() || 'A customer';
      const amount = Number(total ?? 0).toLocaleString('en-NG');
      const report = await this.delivery.deliver({
        recipientId: partnerId,
        contact: { email: partner?.email ?? null, phone: partner?.phone ?? null },
        item: {
          category: 'system',
          priority: 'medium',
          title: `Store order refunded: ${orderNumber}`,
          body: `${customer}'s order was refunded (${currency} ${amount}). Review the order and adjust stock if the item was returned.`,
          icon: 'undo',
          link: '/dashboard/products/store-orders',
          key: `store-order-refunded:${orderId}`,
        },
      });

      let emailed = false;
      if (this.mail && customerEmail) {
        const subject = `Your MarketSpase Store order ${orderNumber} was refunded`;
        const html = `
          <p>Hi ${escapeHtml(customer)},</p>
          <p>Your order <strong>${escapeHtml(orderNumber)}</strong> has been refunded.</p>
          <p><strong>${escapeHtml(currency)} ${escapeHtml(amount)}</strong> is being returned to your original payment method.</p>
          ${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}
          ${refundReference ? `<p>Provider reference: ${escapeHtml(refundReference)}</p>` : ''}
          <p>If you have any questions, contact MarketSpase support and quote this order number.</p>
        `;
        const receipt = await this.mail(customerEmail, subject, html, {
          title: 'Order refunded',
          actionUrl: 'https://marketspase.com/support',
          actionLabel: 'Contact support',
        }).catch(() => null);
        emailed = receipt?.sent === true;
      }

      const notified = report.inApp === 'created' || report.inApp === 'deduped';
      return { status: notified || emailed ? 'notified' : 'skipped', emailed, report };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** @returns unsubscribe function */
export const subscribeStoreOrderFanout = ({ events, delivery, partners, mail = null }) => {
  const fanout = new StoreOrderFanoutUseCase({ delivery, partners, mail });
  const offPaid = events.on(STORE_EVENTS.ORDER_PAID, (payload) => fanout.notifyPaid(payload));
  const offRefunded = events.on(STORE_EVENTS.ORDER_REFUNDED, (payload) => fanout.notifyRefunded(payload));
  return () => {
    offPaid();
    offRefunded();
  };
};
