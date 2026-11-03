export {
  default,
  buildCampaignRouter,
  buildAdminCampaignRouter,
} from './interface/Campaign.routes.js';
export {
  ALLOCATION_WEIGHTS,
  CONTRIBUTION_CAP_NGN,
  MIN_CAMPAIGN_BUDGET_NGN,
  campaignInFlight,
  ownerEligibleForCampaign,
  partnerEligibleForAllocation,
  scoreAllocationPair,
} from './domain/Campaign.allocation.js';
