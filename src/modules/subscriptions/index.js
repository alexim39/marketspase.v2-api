/**
 * Public entry for the subscriptions slice (admin email-list desk).
 * The public subscribe form stays on the legacy route; this slice owns
 * the admin read/manage surface (list, status, delete, export).
 */
export { default as SubscriptionsRouter, buildSubscriptionsRouter } from './interface/Subscription.routes.js';

export { default } from './interface/Subscription.routes.js';

export {
  ListSubscriptionsUseCase, SetSubscriptionStatusUseCase,
  DeleteSubscriptionUseCase, ExportSubscriptionsUseCase,
} from './application/Subscription.usecases.js';
