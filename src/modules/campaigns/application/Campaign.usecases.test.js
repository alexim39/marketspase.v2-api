import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '../../../shared/domain/AppError.js';
import { AllocatePartnersUseCase, CreateGrowthCampaignUseCase, OverrideAllocationUseCase } from './Campaign.usecases.js';

const now = new Date('2026-11-03T12:00:00Z');
const enteredAt = new Date('2026-10-19T12:00:00Z');

const campaign = (overrides = {}) => ({
  _id: '507f1f77bcf86cd799439011',
  ownerId: '507f1f77bcf86cd799439012',
  name: 'Lagos growth',
  status: 'Active',
  budget: { total: 100000 },
  flight: { startAt: new Date('2026-11-01T00:00:00Z'), endAt: null },
  capacity: { total: 1, allocated: 0, maxPerWeek: 2 },
  targetAudience: { states: ['Lagos'] },
  supportQuality: 60,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  ...overrides,
});

const candidate = (overrides = {}) => ({
  queueEntry: { _id: 'queue-1', partnerId: 'partner-1', enteredAt, status: 'queued' },
  partner: {
    _id: 'partner-1',
    name: 'Ada',
    accountState: 'partner',
    kycStatus: 'verified',
    suspendedAt: null,
  },
  partnerState: 'Lagos',
  ...overrides,
});

const allocationResult = () => ({
  allocation: { id: 'allocation-1' },
  campaign: {
    id: 'campaign-1',
    name: 'Lagos growth',
    status: 'Active',
    budget: { total: 100000, spent: 550, refunded: 0, remaining: 99450 },
    capacity: { total: 1, allocated: 1, remaining: 0, maxPerWeek: 2 },
  },
  partner: { id: 'partner-1', name: 'Ada', email: 'ada@example.com' },
});

describe('AllocatePartnersUseCase', () => {
  it('allocates the best pair, emits the fact and stops at campaign capacity', async () => {
    const calls = [];
    const events = [];
    const useCase = new AllocatePartnersUseCase({
      repo: {
        loadAllocationContext: async () => ({
          campaigns: [{ campaign: campaign(), owner: { _id: 'owner-1' }, weeklyAllocated: 0 }],
          candidates: [candidate(), candidate({
            queueEntry: { _id: 'queue-2', partnerId: 'partner-2', enteredAt, status: 'queued' },
            partner: { ...candidate().partner, _id: 'partner-2', name: 'Bola' },
          })],
          now,
        }),
        allocatePair: async (input) => {
          calls.push(input);
          return allocationResult();
        },
      },
      events: { emit: async (name, payload) => events.push({ name, payload }) },
    });

    const result = await useCase.execute({ limit: 10, actorId: 'admin-1' });

    assert.equal(result.allocated.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].queueEntryId, 'queue-1');
    assert.equal(calls[0].weeklyCap, 2);
    assert.equal(events.length, 1);
    assert.equal(events[0].name, 'partner.allocated');
    assert.equal(events[0].payload.allocatedBy, 'admin-1');
    assert.equal(events[0].payload.allocationId, 'allocation-1');
    assert.equal(events[0].payload.campaignName, 'Lagos growth');
  });

  it('never allocates an owner into their own campaign', async () => {
    let called = false;
    const useCase = new AllocatePartnersUseCase({
      repo: {
        loadAllocationContext: async () => ({
          campaigns: [{
            campaign: campaign({ ownerId: 'partner-1' }),
            owner: { _id: 'partner-1' },
            weeklyAllocated: 0,
          }],
          candidates: [candidate()],
          now,
        }),
        allocatePair: async () => { called = true; return allocationResult(); },
      },
      events: { emit: async () => [] },
    });

    const result = await useCase.execute({ limit: 10 });

    assert.equal(result.allocated.length, 0);
    assert.equal(called, false);
  });

  it('records an allocation race without failing the whole run', async () => {
    const useCase = new AllocatePartnersUseCase({
      repo: {
        loadAllocationContext: async () => ({
          campaigns: [{ campaign: campaign(), owner: { _id: 'owner-1' }, weeklyAllocated: 0 }],
          candidates: [candidate()],
          now,
        }),
        allocatePair: async () => {
          throw new ConflictException('Campaign weekly allocation cap reached');
        },
      },
      events: { emit: async () => [] },
    });

    const result = await useCase.execute({ limit: 10 });

    assert.equal(result.allocated.length, 0);
    assert.equal(result.skipped.races, 1);
  });

  it('emits owner, allocation and campaign details on a manual override', async () => {
    const events = [];
    const useCase = new OverrideAllocationUseCase({
      repo: {
        overrideAllocation: async () => ({
          allocation: {
            id: 'allocation-9',
            owner: { id: 'owner-9' },
            campaign: { id: 'campaign-9', name: 'Lagos growth' },
          },
          campaign: { id: 'campaign-9', name: 'Lagos growth' },
          partner: { id: 'partner-9' },
        }),
      },
      events: { emit: async (name, payload) => events.push({ name, payload }) },
    });

    await useCase.execute({
      campaignId: 'campaign-9',
      partnerId: 'partner-9',
      actorId: 'admin-1',
      reason: 'Manual fit',
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].name, 'campaign.allocation.overridden');
    assert.equal(events[0].payload.ownerId, 'owner-9');
    assert.equal(events[0].payload.allocationId, 'allocation-9');
    assert.equal(events[0].payload.campaignName, 'Lagos growth');
  });
});

describe('CreateGrowthCampaignUseCase', () => {
  const input = { name: 'Lagos growth', budgetAmount: 50000, capacityTotal: 2 };

  it('auto-activates a funded campaign and emits the activation fact', async () => {
    const received = [];
    const events = [];
    const useCase = new CreateGrowthCampaignUseCase({
      repo: {
        createCampaign: async (args) => {
          received.push(args);
          return { id: 'campaign-1', status: 'Active' };
        },
      },
      events: { emit: async (name, payload) => events.push({ name, payload }) },
      autoActivate: true,
    });

    const result = await useCase.execute('owner-1', input);

    assert.equal(result.status, 'Active');
    assert.equal(received[0].autoActivate, true);
    assert.equal(received[0].ownerId, 'owner-1');
    assert.deepEqual(received[0].input, input);
    assert.equal(events.length, 1);
    assert.equal(events[0].name, 'campaign.activated');
    assert.equal(events[0].payload.campaignId, 'campaign-1');
    assert.equal(events[0].payload.ownerId, 'owner-1');
    assert.equal(events[0].payload.activatedBy, 'system:auto');
  });

  it('leaves the campaign pending when auto-activation is disabled', async () => {
    const events = [];
    const useCase = new CreateGrowthCampaignUseCase({
      repo: {
        createCampaign: async () => ({ id: 'campaign-1', status: 'Pending' }),
      },
      events: { emit: async (name, payload) => events.push({ name, payload }) },
      autoActivate: false,
    });

    const result = await useCase.execute('owner-1', input);

    assert.equal(result.status, 'Pending');
    assert.equal(events.length, 0);
  });

  it('never lets an activation-event failure break a funded campaign', async () => {
    const useCase = new CreateGrowthCampaignUseCase({
      repo: {
        createCampaign: async () => ({ id: 'campaign-1', status: 'Active' }),
      },
      events: { emit: async () => { throw new Error('subscriber down'); } },
      autoActivate: true,
    });

    const result = await useCase.execute('owner-1', input);

    assert.equal(result.status, 'Active');
  });
});
