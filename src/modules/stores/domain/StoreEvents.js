/** Domain events emitted by the store commerce slice. */
export const STORE_EVENTS = Object.freeze({
  ORDER_PAID: 'store.order.paid',
  ORDER_SHIPPED: 'store.order.shipped',
  ORDER_DELIVERED: 'store.order.delivered',
  ORDER_AUTO_DELIVERED: 'store.order.auto-delivered',
  ORDER_REFUNDED: 'store.order.refunded',
  RETURN_REQUESTED: 'store.return.requested',
  RETURN_DECIDED: 'store.return.decided',
  RETURN_RECEIVED: 'store.return.received',
  RETURN_REFUNDED: 'store.return.refunded',
});
