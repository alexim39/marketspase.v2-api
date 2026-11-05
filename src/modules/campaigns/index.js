export {
  default,
  buildCampaignRouter,
  buildAdminCampaignRouter,
} from './interface/Campaign.routes.js';
export {
  ALLOCATION_WEIGHTS,
  CONTRIBUTION_CAP_NGN,
  COST_PER_PROSPECT_NGN,
  MIN_CAMPAIGN_BUDGET_NGN,
  MIN_PROSPECTS,
  campaignBudgetRemaining,
  campaignInFlight,
  isActivatedPartner,
  isKycVerified,
  ownerEligibleForCampaign,
  partnerEligibleForAllocation,
  scoreAllocationPair,
} from './domain/Campaign.allocation.js';
