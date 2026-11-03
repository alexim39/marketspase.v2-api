export {
  default,
  buildCompensationRouter,
  buildAdminCompensationRouter,
} from './interface/Compensation.routes.js';
export { subscribeCompensation, buildCompensationHandlers } from './application/Compensation.subscribers.js';
export {
  LEVEL_RATES,
  RANK_DEPTH,
  RANKS,
  MENTOR_BONUS_AMOUNT,
  commissionAmount,
  depthAllows,
  planSummary,
  rankDepth,
  rateForLevel,
} from './domain/Compensation.plan.js';
