import { STORE_EVENTS } from '../../stores/domain/StoreEvents.js';
import { storePublicUrl } from '../../stores/domain/StoreOrderAccess.js';

const storeSupportUrl = () => `${storePublicUrl()}/support`;

/** Notify a partner when a customer payment settles into escrow. */
export class StoreOrderFanoutUseCase {
  constructor({ delivery, partners, mail = null }) {
    Object.assign(this, { delivery, partners, mail });
  }

  async notifyPaid({
    partnerId, orderId, orderNumber, customerName, customerEmail = '',
    storeName = '', total, currency = 'NGN', trackingUrl = '',
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
          priority: 'high',
          title: `New paid store order ${orderNumber}`,
          body: `${customer} paid ${currency} ${amount}. Start processing, add tracking and mark delivery to release escrow.`,
          icon: 'shopping_bag',
          link: '/dashboard/products/store-orders',
          key: `store-order-paid:${orderId}`,
        },
      });

      let emailed = false;
      if (this.mail && customerEmail) {
        const subject = `Your MarketSpase Store order ${orderNumber} is confirmed`;
        const html = `
          <p>Hi ${escapeHtml(customer)},</p>
          <p>Thank you — your order <strong>${escapeHtml(orderNumber)}</strong> from
            <strong>${escapeHtml(storeName || 'your MarketSpase partner')}</strong> is confirmed.</p>
          <p>Total paid: <strong>${escapeHtml(currency)} ${escapeHtml(amount)}</strong>.</p>
          ${trackingUrl ? `<p><a href="${escapeHtml(trackingUrl)}">Track your order and delivery status</a></p>` : ''}
          <p>Keep this email — the tracking link is the secure way to view your order.</p>
        `;
        const receipt = await this.mail(customerEmail, subject, html, {
          title: 'Order confirmed',
          actionUrl: trackingUrl || storeSupportUrl(),
          actionLabel: trackingUrl ? 'Track your order' : 'Contact support',
        }).catch(() => null);
        emailed = receipt?.sent === true;
      }

      return {
        status: (report.inApp === 'created' || report.inApp === 'deduped' || emailed)
          ? 'notified' : 'skipped',
        emailed,
        report,
      };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }

  async notifyReturnRequested({
    partnerId, returnId, orderId, reference, orderNumber, customerName, reason = '',
  }) {
    try {
      const customer = String(customerName ?? '').trim() || 'A customer';
      const report = await this.delivery.deliver({
        recipientId: partnerId,
        item: {
          category: 'system',
          priority: 'high',
          title: `Return requested for ${orderNumber}`,
          body: `${customer} requested a return: ${reason || 'no reason supplied'}. Review it in Store orders.`,
          icon: 'assignment_return',
          link: '/dashboard/products/store-orders',
          key: `store-return-requested:${returnId || orderId}`,
        },
      });
      return {
        status: report.inApp === 'created' || report.inApp === 'deduped' ? 'notified' : 'skipped',
        report,
      };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }

  async notifyReturnDecided({
    orderNumber, customerEmail, customerName, status, note = '', reason = '',
  }) {
    if (!this.mail || !customerEmail) return { status: 'skipped', reason: 'no-email' };
    try {
      const label = status === 'approved' ? 'approved' : 'declined';
      const subject = `Your MarketSpase Store return for ${orderNumber} was ${label}`;
      const html = `
        <p>Hi ${escapeHtml(String(customerName ?? '').trim() || 'there')},</p>
        <p>Your return request for order <strong>${escapeHtml(orderNumber)}</strong> was ${label}.</p>
        ${reason ? `<p>Reason given: ${escapeHtml(reason)}</p>` : ''}
        ${note ? `<p>Partner note: ${escapeHtml(note)}</p>` : ''}
        <p>If it was approved, the partner will confirm when the item is received. MarketSpase then processes any refund.</p>
      `;
      const receipt = await this.mail(customerEmail, subject, html, {
        title: `Return ${label}`,
        actionUrl: storeSupportUrl(),
        actionLabel: 'Contact support',
      }).catch(() => null);
      return { status: receipt?.sent === true ? 'sent' : 'skipped', emailed: receipt?.sent === true };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }

  async notifyCustomerStatus({
    orderId, orderNumber, customerEmail, customerName, status, storeName = '',
    trackingUrl = '', courier = '', trackingNumber = '', trackingLink = '',
  }) {
    if (!this.mail || !customerEmail) return { status: 'skipped', reason: 'no-email' };
    const label = status === 'shipped' ? 'shipped' : 'delivered';
    try {
      const subject = `Your MarketSpase Store order ${orderNumber} was ${label}`;
      const shippingLine = [
        courier ? `Courier: ${courier}.` : '',
        trackingNumber ? `Tracking number: ${trackingNumber}.` : '',
      ].filter(Boolean).join(' ');
      const html = `
        <p>Hi ${escapeHtml(String(customerName ?? '').trim() || 'there')},</p>
        <p>Your order <strong>${escapeHtml(orderNumber)}</strong> from
          <strong>${escapeHtml(storeName || 'your MarketSpase partner')}</strong> was ${label}.</p>
        ${shippingLine ? `<p>${escapeHtml(shippingLine)}</p>` : ''}
        ${trackingLink ? `<p><a href="${escapeHtml(trackingLink)}">Open the courier tracking link</a></p>` : ''}
        ${trackingUrl ? `<p><a href="${escapeHtml(trackingUrl)}">View your order and delivery status</a></p>` : ''}
        <p>If something looks wrong, contact the partner or MarketSpase support and quote this order number.</p>
      `;
      const receipt = await this.mail(customerEmail, subject, html, {
        title: `Order ${label}`,
        actionUrl: trackingUrl || storeSupportUrl(),
        actionLabel: trackingUrl ? 'View order' : 'Contact support',
      }).catch(() => null);
      return { status: receipt?.sent === true ? 'sent' : 'skipped', emailed: receipt?.sent === true };
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
          actionUrl: storeSupportUrl(),
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
  const offShipped = events.on(STORE_EVENTS.ORDER_SHIPPED, (payload) => (
    fanout.notifyCustomerStatus({ ...payload, status: 'shipped' })
  ));
  const offDelivered = events.on(STORE_EVENTS.ORDER_DELIVERED, (payload) => (
    fanout.notifyCustomerStatus({ ...payload, status: 'delivered' })
  ));
  const offAutoDelivered = events.on(STORE_EVENTS.ORDER_AUTO_DELIVERED, (payload) => (
    fanout.notifyCustomerStatus({ ...payload, status: 'delivered' })
  ));
  const offRefunded = events.on(STORE_EVENTS.ORDER_REFUNDED, (payload) => fanout.notifyRefunded(payload));
  const offReturnRequested = events.on(STORE_EVENTS.RETURN_REQUESTED, (payload) => (
    fanout.notifyReturnRequested(payload)
  ));
  const offReturnDecided = events.on(STORE_EVENTS.RETURN_DECIDED, (payload) => (
    fanout.notifyReturnDecided(payload)
  ));
  return () => {
    offPaid();
    offShipped();
    offDelivered();
    offAutoDelivered();
    offRefunded();
    offReturnRequested();
    offReturnDecided();
  };
};
