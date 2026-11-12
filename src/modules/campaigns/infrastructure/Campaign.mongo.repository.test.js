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
});
