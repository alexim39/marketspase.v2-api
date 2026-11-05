import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaimBonusUseCase, DeleteBonusCampaignUseCase, GetEligibleBonusUseCase, UpdateBonusCampaignUseCase } from './Bonus.usecases.js';

const campaign = (over = {}) => ({
  _id: 'c1',
  title: 'Welcome bonus',
  message: 'Claim it',
  amountNgn: 2500,
  status: 'active',
  eligibleAfter: new Date('2025-01-01T00:00:00Z'),
  startsAt: new Date('2025-01-01T00:00:00Z'),
  endsAt: null,
  ...over,
});

const C1 = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const C2 = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const chain = (rows) => rows;
const member = (createdAt) => ({ findById: async () => ({ createdAt }) });
const oneCampaign = (doc) => ({ findById: async () => doc });
const CREATED = new Date('2026-01-01T00:00:00Z');

test('eligible returns the first unclaimed live campaign', async () => {
  const uc = new GetEligibleBonusUseCase({
    campaigns: { find: () => chain([campaign({ _id: C1 })]) },
    claims: { findOne: async () => null },
    partners: member(CREATED),
  });
  const res = await uc.execute({ partnerId: 'p1' });
  assert.equal(res.campaign.amountNgn, 2500);
  assert.equal(res.claimed, false);
});

test('eligible skips claimed and ineligible campaigns', async () => {
  const uc = new GetEligibleBonusUseCase({
    campaigns: { find: () => chain([campaign({ _id: C1 }), campaign({ _id: C2 })]) },
    claims: { findOne: async ({ campaignId }) => (String(campaignId) === C1 ? { _id: 'x' } : null) },
    partners: member(CREATED),
  });
  const res = await uc.execute({ partnerId: 'p1' });
  assert.equal(res.campaign.id, C2);
});

test('eligible is empty when nothing is live', async () => {
  const uc = new GetEligibleBonusUseCase({
    campaigns: { find: () => chain([campaign({ status: 'disabled' })]) },
    claims: { findOne: async () => null },
    partners: member(new Date()),
  });
  const res = await uc.execute({ partnerId: 'p1' });
  assert.equal(res.campaign, null);
});

test('claim rejects duplicates and dead campaigns', async () => {
  const dup = new ClaimBonusUseCase({
    campaigns: oneCampaign(campaign()),
    claims: { findOne: async () => ({ _id: 'x' }) },
    partners: member(CREATED),
  });
  await assert.rejects(dup.execute({ partnerId: 'p1', campaignId: C1 }), /already claimed/);

  const dead = new ClaimBonusUseCase({
    campaigns: oneCampaign(campaign({ status: 'disabled' })),
    claims: { findOne: async () => null },
    partners: member(CREATED),
  });
  await assert.rejects(dead.execute({ partnerId: 'p1', campaignId: C1 }), /no longer available/);

  const badId = new ClaimBonusUseCase({});
  await assert.rejects(badId.execute({ partnerId: 'p1', campaignId: 'nope' }), /Invalid campaign/);
});

test('admin update writes every editable field', async () => {
  const doc = {
    ...campaign(),
    save: async function () { this.saved = true; },
    toObject() { return { ...this }; },
  };
  const uc = new UpdateBonusCampaignUseCase({
    campaigns: { findById: async () => doc },
    claims: { countDocuments: async () => 4 },
  });
  const res = await uc.execute({
    campaignId: C1,
    patch: {
      title: 'Updated title',
      message: 'Updated message',
      amountNgn: 5000,
      status: 'disabled',
      startsAt: '2026-01-01',
      endsAt: '2026-12-31',
      eligibleAfter: '2026-02-01',
    },
  });
  assert.equal(doc.title, 'Updated title');
  assert.equal(doc.message, 'Updated message');
  assert.equal(doc.amountNgn, 5000);
  assert.equal(doc.status, 'disabled');
  assert.ok(doc.startsAt instanceof Date);
  assert.ok(doc.endsAt instanceof Date);
  assert.ok(doc.eligibleAfter instanceof Date);
  assert.equal(res.campaign.claims, 4);
  assert.equal(res.campaign.status, 'disabled');
});

test('admin delete removes the campaign and reports claim history', async () => {
  let deleted = null;
  const uc = new DeleteBonusCampaignUseCase({
    campaigns: {
      findByIdAndDelete: async (id) => {
        deleted = id;
        return { _id: id, title: 'Welcome bonus' };
      },
    },
    claims: { countDocuments: async () => 7 },
  });
  const res = await uc.execute({ campaignId: C1 });
  assert.equal(deleted, C1);
  assert.equal(res.deleted, true);
  assert.equal(res.claims, 7);
});

