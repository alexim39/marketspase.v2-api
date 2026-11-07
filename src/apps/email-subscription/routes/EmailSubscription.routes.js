import express from 'express';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { validate, validateBodyInPlace } from '../../../shared/http/validate.js';
import {
  confirmEmailSubscription,
  emailSubscription,
  unsubscribeEmailSubscription,
} from '../controllers/email-subscription.controller.js';
import { SubscribeSchema, TokenParamsSchema } from './EmailSubscription.validator.js';

/**
 * Contract: /v1/email-subscription — public newsletter subscribe and the
 * tokenised confirm/unsubscribe links embedded in outbound email.
 * The legacy unauthenticated delete-by-id route is retired; admin deletion
 * lives under /v1/admin/subscriptions.
 */
export const buildEmailSubscriptionRouter = ({
  subscribe = emailSubscription,
  confirm = confirmEmailSubscription,
  unsubscribe = unsubscribeEmailSubscription,
} = {}) => {
  const router = express.Router();
  const subscribeLimit = rateLimit({ name: 'email-subscribe', windowMs: 10 * 60 * 1000, max: 5 });
  const tokenLimit = rateLimit({ name: 'email-token', windowMs: 60 * 1000, max: 30 });

  router.post('/subscribe', subscribeLimit, validateBodyInPlace(SubscribeSchema), subscribe);
  router.get('/confirm/:token', tokenLimit, validate({ params: TokenParamsSchema }), confirm);
  router.get('/unsubscribe/:token', tokenLimit, validate({ params: TokenParamsSchema }), unsubscribe);

  return router;
};

export default buildEmailSubscriptionRouter();
