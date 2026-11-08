import { StoreOrderRepository } from '../modules/stores/infrastructure/StoreOrder.mongo.repository.js';

/**
 * Release stock held by checkout orders that never completed. The repository
 * re-checks Paystack before cancelling, so a still-open checkout is extended
 * rather than released.
 */
export const runStoreOrderExpiryJob = async (deps = {}) => {
  const repo = deps.repo ?? new StoreOrderRepository();
  const started = Date.now();
  try {
    const result = await repo.expirePendingOrders();
    console.log(
      `[jobs] store-order-expiry: ${result.cancelled} cancelled, ${result.paid} settled, ${result.extended} extended in ${Date.now() - started}ms`,
    );
    return result;
  } catch (error) {
    console.error('[jobs] store-order-expiry crashed:', error?.message ?? error);
    return { checked: 0, cancelled: 0, paid: 0, extended: 0 };
  }
};

/** Move delivered store-order earnings from escrow to the partner wallet. */
export const runStoreEscrowReleaseJob = async (deps = {}) => {
  const repo = deps.repo ?? new StoreOrderRepository();
  const started = Date.now();
  try {
    const result = await repo.releaseDueEscrows();
    console.log(
      `[jobs] store-escrow-release: ${result.released}/${result.checked} orders released in ${Date.now() - started}ms`,
    );
    return result;
  } catch (error) {
    console.error('[jobs] store-escrow-release crashed:', error?.message ?? error);
    return { checked: 0, released: 0 };
  }
};

/** Auto-deliver orders that have been in transit past the configured window. */
export const runStoreAutoDeliverJob = async (deps = {}) => {
  const repo = deps.repo ?? new StoreOrderRepository();
  const started = Date.now();
  try {
    const result = await repo.autoDeliverShippedOrders();
    console.log(
      `[jobs] store-auto-deliver: ${result.delivered}/${result.checked} orders delivered in ${Date.now() - started}ms`,
    );
    return result;
  } catch (error) {
    console.error('[jobs] store-auto-deliver crashed:', error?.message ?? error);
    return { checked: 0, delivered: 0 };
  }
};
