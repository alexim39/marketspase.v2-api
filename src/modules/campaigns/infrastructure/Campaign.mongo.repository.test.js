import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import { GrowthCampaignModel } from './Campaign.models.js';
import { MongoCampaignRepository } from './Campaign.mongo.repository.js';

const ownerId = 'a'.repeat(24);
const campaignId = 'b'.repeat(24);
const now = new Date('2026-11-12T12:00:00Z');

const input = {
  name: 'Lagos growth',
  category: 'Network marketing',
  brief: 'Find activated partners in Lagos',
  budgetAmount: 50000,
  capacityTotal: 2,
  maxPerWeek: 2,
  targetStates: ['Lagos'],
  startAt: new Date('2026-11-12T00:00:00Z'),
};

const eligibleOwner = {
  _id: ownerId,
  name: 'Ada',
  surname: 'Obi',
  username: 'ada',
  email: 'ada@example.com',
  accountState: 'partner',
  kycStatus: 'verified',
  suspendedAt: null,
};

const restore = [];
const patch = (target, key, value) => {
  restore.push([target, key, target[key]]);
  target[key] = value;
};

const tree = (rows) => ({
  select() { return this; },
  async lean() { return rows; },
});

afterEach(() => {
  while (restore.length > 0) {
    const [target, key, value] = restore.pop();
    target[key] = value;
  }
});

const prepareCreate = ({ balance = 100000 } = {}) => {
  const captured = { campaign: null, transaction: null };
  const repo = new MongoCampaignRepository();
  repo.findPartner = async () => eligibleOwner;

  patch(PartnersModel, 'findOneAndUpdate', () => ({
    lean: async () => ({ balance }),
  }));
  patch(GrowthCampaignModel, 'create', async ([doc]) => {
    captured.campaign = doc;
    const created = { ...doc, _id: campaignId, createdAt: now };
    return [{ ...created, toObject: () => created }];
  });
  patch(TransactionModel, 'create', async ([doc]) => {
    captured.transaction = doc;
    return [doc];
  });

  return { repo, captured };
};

describe('MongoCampaignRepository campaign activation', () => {
  it('goes live in the same transaction that debits the funding wallet', async () => {
    const { repo, captured } = prepareCreate();

    const result = await repo.createCampaign({ ownerId, input, now });

    assert.equal(captured.campaign.status, 'Active');
    assert.deepEqual(captured.campaign.activatedAt, now);
    assert.equal(String(captured.campaign.activatedBy), ownerId);
    assert.equal(result.status, 'Active');
    assert.deepEqual(result.activatedAt, now);
    assert.equal(captured.transaction.amount, 50000);
    assert.equal(captured.transaction.transactionType, 'Debit');
    assert.equal(captured.transaction.balanceAfter, 100000);
  });

  it('keeps the manual review queue when auto-activation is disabled', async () => {
    const { repo, captured } = prepareCreate();

    const result = await repo.createCampaign({
      ownerId,
      input,
      autoActivate: false,
      now,
    });

    assert.equal(captured.campaign.status, 'Pending');
    assert.equal(captured.campaign.activatedAt, undefined);
    assert.equal(result.status, 'Pending');
  });

  it('refuses to create an already-ended flight as an active campaign', async () => {
    const repo = new MongoCampaignRepository();

    await assert.rejects(
      () => repo.createCampaign({
        ownerId,
        input: {
          ...input,
          startAt: new Date('2026-10-01T00:00:00Z'),
          endAt: new Date('2026-11-01T00:00:00Z'),
        },
        now,
      }),
      (error) => error.statusCode === 400 && /End date must be in the future/.test(error.message),
    );
  });

  it('builds campaign analytics with a zero-filled daily series', async () => {
    const campaign = {
      _id: campaignId,
      ownerId,
      trackingCode: 'gc_test',
      name: 'Lagos growth',
      status: 'Active',
      budget: { total: 50000, spent: 550, refunded: 0 },
      flight: { startAt: new Date('2026-11-01T00:00:00Z'), endAt: null },
      capacity: { total: 2, allocated: 1, maxPerWeek: 2 },
      targetAudience: { states: ['Lagos'] },
      supportQuality: 60,
      createdAt: new Date('2026-11-01T00:00:00Z'),
    };
    let campaignFilter = null;
    let pipeline = null;
    patch(GrowthCampaignModel, 'findOne', (filter) => {
      campaignFilter = filter;
      return { lean: async () => campaign };
    });
    patch(PartnersModel, 'aggregate', async (stages) => {
      pipeline = stages;
      return [{
        summary: [{
          signups: 10,
          activated: 6,
          kycVerified: 5,
          eligible7: 4,
          retained7: 3,
          lastSignupAt: new Date('2026-11-11T00:00:00Z'),
          lastActivityAt: new Date('2026-11-12T00:00:00Z'),
        }],
        signupSeries: [
          { _id: '2026-11-10', count: 2 },
          { _id: '2026-11-11', count: 1 },
        ],
        activationSeries: [{ _id: '2026-11-11', count: 1 }],
      }];
    });

    const repo = new MongoCampaignRepository();
    const result = await repo.analyticsForCampaign({
      campaignId,
      ownerId,
      days: 7,
      now,
    });

    assert.deepEqual(campaignFilter, { _id: campaignId, ownerId });
    assert.deepEqual(pipeline[0], { $match: { campaignCode: 'gc_test' } });
    assert.equal(result.campaign.id, campaignId);
    assert.equal(result.windowDays, 7);
    assert.equal(result.summary.signups, 10);
    assert.equal(result.summary.activated, 6);
    assert.equal(result.summary.activationRate, 60);
    assert.equal(result.summary.eligible7, 4);
    assert.equal(result.summary.retained7, 3);
    assert.equal(result.summary.retentionRate, 75);
    assert.equal(result.series.length, 7);
    assert.deepEqual(result.series.at(-2), {
      date: '2026-11-11',
      signups: 1,
      activated: 1,
    });
    assert.deepEqual(result.series.at(-1), {
      date: '2026-11-12',
      signups: 0,
      activated: 0,
    });
  });

  it('does not expose another owner’s campaign analytics', async () => {
    patch(GrowthCampaignModel, 'findOne', () => ({ lean: async () => null }));
    const repo = new MongoCampaignRepository();

    await assert.rejects(
      () => repo.analyticsForCampaign({ campaignId, ownerId }),
      (error) => error.statusCode === 404,
    );
  });

  it('adds retention and last activity to the admin attribution rows', async () => {
    patch(PartnersModel, 'aggregate', async () => [{
      _id: 'gc_test',
      signups: 5,
      activated: 4,
      kycVerified: 4,
      eligible7: 3,
      retained7: 2,
      lastSignupAt: new Date('2026-11-10T00:00:00Z'),
      lastActivityAt: new Date('2026-11-12T00:00:00Z'),
    }]);
    patch(GrowthCampaignModel, 'find', () => tree([{
      _id: campaignId,
      trackingCode: 'gc_test',
      name: 'Lagos growth',
      status: 'Active',
    }]));

    const repo = new MongoCampaignRepository();
    const rows = await repo.attribution(10, now);

    assert.equal(rows[0].signups, 5);
    assert.equal(rows[0].activated, 4);
    assert.equal(rows[0].eligible7, 3);
    assert.equal(rows[0].retained7, 2);
    assert.equal(rows[0].retentionRate, 66.67);
    assert.deepEqual(rows[0].lastActivityAt, new Date('2026-11-12T00:00:00Z'));
  });
});
