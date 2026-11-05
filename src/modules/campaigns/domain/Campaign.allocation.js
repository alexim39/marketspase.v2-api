export const ALLOCATION_WEIGHTS = Object.freeze({
  fairness: 0.4,
  contribution: 0.25,
  fit: 0.2,
  capacitySupport: 0.15,
});

export const CONTRIBUTION_CAP_NGN = 500000;
/** Each allocated prospect consumes this much of the campaign budget. */
export const COST_PER_PROSPECT_NGN = 550;
/** A campaign must be able to fund at least this many prospects. */
export const MIN_PROSPECTS = 2;
export const MIN_CAMPAIGN_BUDGET_NGN = COST_PER_PROSPECT_NGN * MIN_PROSPECTS;
export const DEFAULT_CAPACITY = 2;
export const DEFAULT_MAX_PER_WEEK = 2;
export const DAY_MS = 24 * 60 * 60 * 1000;

const clamp = (value, min = 0, max = 100) => Math.min(Math.max(Number(value) || 0, min), max);
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const normalized = (value) => String(value ?? '').trim().toLowerCase();

/** Remaining budget after spend and refunds. */
export const campaignBudgetRemaining = (campaign) => Math.max(
  Number(campaign?.budget?.total ?? 0)
  - Number(campaign?.budget?.spent ?? 0)
  - Number(campaign?.budget?.refunded ?? 0),
  0,
);

export const campaignInFlight = (campaign, now = new Date()) => {
  if (!campaign || campaign.status !== 'Active') return false;
  const start = new Date(campaign.flight?.startAt ?? 0).getTime();
  const end = campaign.flight?.endAt ? new Date(campaign.flight.endAt).getTime() : null;
  const at = new Date(now).getTime();
  return Number.isFinite(start) && start <= at && (!end || at < end);
};

export const isActivatedPartner = (partner) => {
  if (!partner) return false;
  if (partner.accountState === 'member') return false;
  return partner.accountState == null || partner.accountState === 'partner';
};

export const isKycVerified = (partner) => {
  if (!partner) return false;
  return partner.kycStatus == null || partner.kycStatus === 'verified';
};

export const ownerEligibleForCampaign = (owner) => {
  if (!isActivatedPartner(owner)) return false;
  if (owner.suspendedAt) return false;
  return isKycVerified(owner);
};

export const partnerEligibleForAllocation = (partner) => {
  if (!partner) return false;
  if (!ownerEligibleForCampaign(partner)) return false;
  if (partner.placementParentId) return false;
  return true;
};

export const campaignCapacity = (campaign, weeklyAllocated = 0) => {
  const total = Math.max(Number(campaign?.capacity?.total) || 0, 0);
  const allocated = Math.max(Number(campaign?.capacity?.allocated) || 0, 0);
  const maxPerWeek = Math.max(Number(campaign?.capacity?.maxPerWeek) || DEFAULT_MAX_PER_WEEK, 1);
  return {
    remaining: Math.max(total - allocated, 0),
    weeklyRemaining: Math.max(maxPerWeek - weeklyAllocated, 0),
  };
};

export const scoreAllocationPair = ({
  campaign,
  queueEntry,
  partner,
  partnerState = '',
  weeklyAllocated = 0,
  now = new Date(),
}) => {
  if (!campaignInFlight(campaign, now)) return null;
  if (!partnerEligibleForAllocation(partner)) return null;
  if (String(partner._id) === String(campaign.ownerId)) return null;

  const capacity = campaignCapacity(campaign, weeklyAllocated);
  if (capacity.remaining <= 0 || capacity.weeklyRemaining <= 0) return null;
  if (campaignBudgetRemaining(campaign) < COST_PER_PROSPECT_NGN) return null;

  const enteredAt = new Date(queueEntry?.enteredAt ?? now).getTime();
  const waitDays = Math.max((new Date(now).getTime() - enteredAt) / DAY_MS, 0);
  const fairness = clamp((waitDays / 30) * 100);

  const budgetTotal = Math.max(Number(campaign?.budget?.total) || 0, 0);
  const contribution = clamp(Math.sqrt(Math.min(budgetTotal / CONTRIBUTION_CAP_NGN, 1)) * 100);

  const targets = (campaign?.targetAudience?.states ?? []).map(normalized).filter(Boolean);
  const state = normalized(partnerState);
  let fit = 60;
  let fitReason = 'No regional target - neutral fit';
  if (targets.length > 0) {
    if (!state) {
      fit = 40;
      fitReason = 'Partner state unknown';
    } else if (targets.includes(state)) {
      fit = 100;
      fitReason = `State match: ${partnerState}`;
    } else {
      // Preferred states improve fit but never block allocation. When none of
      // the preferred states have an available prospect, the engine falls back
      // to any eligible prospect instead of starving the campaign.
      fit = 20;
      fitReason = `Fallback: outside preferred states (${partnerState})`;
    }
  }

  const supportQuality = clamp(campaign?.supportQuality ?? 60);
  const capacityRatio = clamp((capacity.remaining / Math.max(Number(campaign?.capacity?.total) || 1, 1)) * 100);
  const capacitySupport = round((supportQuality * 0.5) + (capacityRatio * 0.5));

  const total = round(
    (fairness * ALLOCATION_WEIGHTS.fairness)
    + (contribution * ALLOCATION_WEIGHTS.contribution)
    + (fit * ALLOCATION_WEIGHTS.fit)
    + (capacitySupport * ALLOCATION_WEIGHTS.capacitySupport),
  );

  return {
    total,
    score: {
      fairness: round(fairness),
      contribution: round(contribution),
      fit: round(fit),
      capacitySupport,
      total,
    },
    components: {
      waitDays: round(waitDays),
      budgetTotal,
      supportQuality: round(supportQuality),
      capacityRemaining: capacity.remaining,
      partnerState: partnerState || '',
    },
    explanation: [
      `Fairness: ${round(waitDays)} days waiting (${round(fairness)}/100)`,
      `Campaign contribution: NGN ${budgetTotal.toLocaleString()} (${round(contribution)}/100)`,
      `${fitReason} (${round(fit)}/100)`,
      `Capacity/support: ${capacity.remaining}/${Number(campaign?.capacity?.total) || 0} slots open, support ${round(supportQuality)}/100 (${capacitySupport}/100)`,
    ],
  };
};
