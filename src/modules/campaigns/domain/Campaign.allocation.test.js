import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOCATION_WEIGHTS,
  COST_PER_PROSPECT_NGN,
  campaignBudgetRemaining,
  campaignInFlight,
  ownerEligibleForCampaign,
  partnerEligibleForAllocation,
  scoreAllocationPair,
} from './Campaign.allocation.js';

const now = new Date('2026-11-03T12:00:00Z');
const enteredAt = new Date('2026-10-19T12:00:00Z');

const campaign = (overrides = {}) => ({
  _id: 'campaign-1',
  ownerId: 'owner-1',
  status: 'Active',
  budget: { total: 100000 },
  flight: {
    startAt: new Date('2026-11-01T00:00:00Z'),
    endAt: null,
  },
  capacity: { total: 4, allocated: 1, maxPerWeek: 2 },
  targetAudience: { states: ['Lagos'] },
  supportQuality: 60,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  ...overrides,
});

const partner = (overrides = {}) => ({
  _id: 'partner-1',
  accountState: 'partner',
  kycStatus: 'verified',
  suspendedAt: null,
  placementParentId: null,
  ...overrides,
});

const queueEntry = (overrides = {}) => ({
  _id: 'queue-1',
  partnerId: 'partner-1',
  enteredAt,
  status: 'queued',
  ...overrides,
});

describe('campaign allocation gates', () => {
  it('accepts only active campaigns inside their flight', () => {
    assert.equal(campaignInFlight(campaign(), now), true);
    assert.equal(campaignInFlight(campaign({ status: 'Pending' }), now), false);
    assert.equal(campaignInFlight(campaign({ flight: { startAt: new Date('2026-11-04T00:00:00Z'), endAt: null } }), now), false);
    assert.equal(campaignInFlight(campaign({ flight: { startAt: new Date('2026-11-01T00:00:00Z'), endAt: new Date('2026-11-02T00:00:00Z') } }), now), false);
  });

  it('requires activated, verified, unsuspended partners who are not placed', () => {
    assert.equal(partnerEligibleForAllocation(partner()), true);
    assert.equal(partnerEligibleForAllocation(partner({ accountState: 'member' })), false);
    assert.equal(partnerEligibleForAllocation(partner({ kycStatus: 'pending' })), false);
    assert.equal(partnerEligibleForAllocation(partner({ suspendedAt: new Date() })), false);
    assert.equal(partnerEligibleForAllocation(partner({ placementParentId: 'owner-9' })), false);
  });

  it('campaign owners must be activated and KYC verified but may be placed under another owner', () => {
    assert.equal(ownerEligibleForCampaign(partner({ placementParentId: 'owner-9' })), true);
    assert.equal(ownerEligibleForCampaign(partner({ kycStatus: 'pending' })), false);
  });

  it('treats legacy accounts with missing activation/KYC fields as active and verified', () => {
    const legacy = { _id: 'legacy', suspendedAt: null, placementParentId: null };
    assert.equal(ownerEligibleForCampaign(legacy), true);
    assert.equal(partnerEligibleForAllocation(legacy), true);
    assert.equal(ownerEligibleForCampaign({ ...legacy, accountState: 'member' }), false);
    assert.equal(ownerEligibleForCampaign({ ...legacy, kycStatus: 'pending' }), false);
  });
});

describe('fair allocation score', () => {
  it('scores fairness, contribution, fit and capacity on the documented weights', () => {
    const result = scoreAllocationPair({
      campaign: campaign(),
      queueEntry: queueEntry(),
      partner: partner(),
      partnerState: 'Lagos',
      weeklyAllocated: 0,
      now,
    });

    assert.ok(result);
    assert.equal(result.score.fairness, 50);
    assert.equal(result.score.fit, 100);
    assert.equal(result.score.capacitySupport, 67.5);
    assert.ok(result.score.contribution > 44 && result.score.contribution < 45);
    assert.ok(Math.abs(
      result.score.fairness * ALLOCATION_WEIGHTS.fairness
      + result.score.contribution * ALLOCATION_WEIGHTS.contribution
      + result.score.fit * ALLOCATION_WEIGHTS.fit
      + result.score.capacitySupport * ALLOCATION_WEIGHTS.capacitySupport
      - result.score.total,
    ) < 0.02);
    assert.equal(result.components.waitDays, 15);
    assert.equal(result.explanation.length, 4);
  });

  it('never allocates a partner to their own campaign', () => {
    assert.equal(scoreAllocationPair({
      campaign: campaign({ ownerId: 'partner-1' }),
      queueEntry: queueEntry(),
      partner: partner(),
      partnerState: 'Lagos',
      now,
    }), null);
  });

  it('refuses a campaign at its weekly cap', () => {
    assert.equal(scoreAllocationPair({
      campaign: campaign(),
      queueEntry: queueEntry(),
      partner: partner(),
      partnerState: 'Lagos',
      weeklyAllocated: 2,
      now,
    }), null);
  });

  it('refuses a full campaign and an ineligible partner', () => {
    assert.equal(scoreAllocationPair({
      campaign: campaign({ capacity: { total: 2, allocated: 2, maxPerWeek: 2 } }),
      queueEntry: queueEntry(),
      partner: partner(),
      partnerState: 'Lagos',
      now,
    }), null);

    assert.equal(scoreAllocationPair({
      campaign: campaign(),
      queueEntry: queueEntry(),
      partner: partner({ kycStatus: 'rejected' }),
      partnerState: 'Lagos',
      now,
    }), null);
  });

  it('caps contribution so a huge budget cannot dominate the score', () => {
    const small = scoreAllocationPair({
      campaign: campaign({ budget: { total: 500000 } }),
      queueEntry: queueEntry(),
      partner: partner(),
      partnerState: 'Lagos',
      now,
    });
    const huge = scoreAllocationPair({
      campaign: campaign({ budget: { total: 10000000 } }),
      queueEntry: queueEntry(),
      partner: partner(),
      partnerState: 'Lagos',
      now,
    });

    assert.equal(small.score.contribution, 100);
    assert.equal(huge.score.contribution, 100);
  });

  it('penalises out-of-area partners without excluding them', () => {
    const result = scoreAllocationPair({
      campaign: campaign(),
      queueEntry: queueEntry(),
      partner: partner(),
      partnerState: 'Kano',
      now,
    });

    assert.ok(result);
    assert.equal(result.score.fit, 20);
    assert.match(result.explanation.join(' '), /Fallback: outside preferred states/);
  });

  it('refuses a campaign whose remaining budget cannot cover one more prospect', () => {
    const exhausted = campaign({
      budget: { total: 5000, spent: 5000 - (COST_PER_PROSPECT_NGN - 1), refunded: 0 },
    });
    assert.equal(campaignBudgetRemaining(exhausted), COST_PER_PROSPECT_NGN - 1);
    assert.equal(scoreAllocationPair({
      campaign: exhausted,
      queueEntry: queueEntry(),
      partner: partner(),
      partnerState: 'Lagos',
      now,
    }), null);
  });
});
