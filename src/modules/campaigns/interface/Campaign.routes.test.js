import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  buildAdminCampaignRouter,
  buildCampaignRouter,
} from './Campaign.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

const partnerId = '507f1f77bcf86cd799439011';
const campaignId = '507f1f77bcf86cd799439012';

const auth = (req, _res, next) => {
  req.auth = { partnerId, role: 'admin' };
  next();
};

let createdInput = null;

const app = express();
app.use(express.json());
app.use('/v1/campaigns', buildCampaignRouter({
  auth,
  recordAudit: async () => null,
  listMine: { execute: async () => [{ id: campaignId, name: 'Lagos growth', status: 'Pending' }] },
  getMine: { execute: async () => ({ id: campaignId, name: 'Lagos growth' }) },
  create: {
    execute: async (_ownerId, input) => {
      createdInput = input;
      return { id: campaignId, name: input.name, status: 'Pending', budget: { total: input.budgetAmount } };
    },
  },
  cancel: { execute: async () => ({ id: campaignId, status: 'Cancelled' }) },
  pause: { execute: async () => ({ id: campaignId, status: 'Paused' }) },
  resume: { execute: async () => ({ id: campaignId, status: 'Active' }) },
  mine: {
    execute: async () => ({
      queue: { status: 'queued', position: 3 },
      allocation: null,
    }),
  },
  placed: {
    execute: async () => [{ id: 'placement-1', partner: { id: partnerId, name: 'Bola' } }],
  },
}));
app.use('/v1/admin/campaigns', buildAdminCampaignRouter({
  auth,
  recordAudit: async () => null,
  admin: (_req, _res, next) => next(),
  list: {
    execute: async (query) => ({
      data: [{ id: campaignId, status: 'Pending', owner: { id: partnerId, name: 'Ada' } }],
      meta: { page: query.page, limit: query.limit, total: 1, pages: 1 },
    }),
  },
  queue: {
    execute: async () => ({
      data: [{ queueEntryId: 'queue-1', partner: { id: partnerId, name: 'Bola' }, position: 1 }],
      meta: { total: 1, limit: 200, capped: false },
    }),
  },
  allocate: {
    execute: async ({ campaignId: id, limit }) => ({
      allocated: [],
      skipped: { races: 0, failures: 0 },
      context: { campaigns: id ? 1 : 2, candidates: 3, remainingCandidates: 3, limit },
    }),
  },
  activate: {
    execute: async () => ({ id: campaignId, status: 'Active', owner: { id: partnerId, name: 'Ada' } }),
  },
  reject: {
    execute: async () => ({ id: campaignId, status: 'Cancelled', owner: { id: partnerId, name: 'Ada' } }),
  },
  pause: { execute: async () => ({ id: campaignId, status: 'Paused' }) },
  resume: { execute: async () => ({ id: campaignId, status: 'Active' }) },
  end: {
    execute: async (_id, _admin, spentAmount) => ({
      id: campaignId,
      status: 'Ended',
      budget: { spent: spentAmount },
      owner: { id: partnerId, name: 'Ada' },
    }),
  },
}));
app.use(errorMiddleware);

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = async (path, body = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const payload = {
  name: 'Lagos growth',
  category: 'Network marketing',
  brief: 'Find activated partners in Lagos',
  budgetAmount: 50000,
  capacityTotal: 4,
  maxPerWeek: 2,
  targetStates: ['Lagos'],
};

describe('growth campaign partner routes', () => {
  it('lists the owner campaigns', async () => {
    const response = await fetch(`${baseUrl}/v1/campaigns`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data[0].name, 'Lagos growth');
  });

  it('creates a funded campaign with the validated body', async () => {
    const result = await post('/v1/campaigns', payload);

    assert.equal(result.status, 201);
    assert.equal(result.body.data.status, 'Pending');
    assert.equal(createdInput.budgetAmount, 50000);
    assert.deepEqual(createdInput.targetStates, ['Lagos']);
  });

  it('rejects a budget below the platform minimum before the use case', async () => {
    createdInput = null;
    const result = await post('/v1/campaigns', { ...payload, budgetAmount: 5000 });

    assert.equal(result.status, 400);
    assert.equal(createdInput, null);
  });

  it('serves the queue/allocation status for the signed-in partner', async () => {
    const response = await fetch(`${baseUrl}/v1/campaigns/me/allocation`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.queue.position, 3);
  });

  it('serves partners placed under the campaign owner', async () => {
    const response = await fetch(`${baseUrl}/v1/campaigns/me/placed-partners`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data[0].partner.name, 'Bola');
  });

  it('cancels, pauses and resumes a campaign without an owner id in the URL', async () => {
    assert.equal((await post(`/v1/campaigns/${campaignId}/cancel`, { reason: 'Changed plan' })).status, 200);
    assert.equal((await post(`/v1/campaigns/${campaignId}/pause`)).status, 200);
    assert.equal((await post(`/v1/campaigns/${campaignId}/resume`)).status, 200);
  });
});

describe('growth campaign admin routes', () => {
  it('lists campaigns and the activation queue', async () => {
    const campaigns = await fetch(`${baseUrl}/v1/admin/campaigns?status=Pending`);
    const queue = await fetch(`${baseUrl}/v1/admin/campaigns/queue`);

    assert.equal(campaigns.status, 200);
    assert.equal((await campaigns.json()).data[0].status, 'Pending');
    assert.equal(queue.status, 200);
    assert.equal((await queue.json()).data[0].position, 1);
  });

  it('activates a pending campaign', async () => {
    const result = await post(`/v1/admin/campaigns/${campaignId}/activate`);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.status, 'Active');
  });

  it('runs allocation across active campaigns', async () => {
    const result = await post('/v1/admin/campaigns/allocate', { limit: 5 });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.context.campaigns, 2);
  });

  it('runs allocation for one campaign', async () => {
    const result = await post(`/v1/admin/campaigns/${campaignId}/allocate`, { limit: 5 });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.context.campaigns, 1);
  });

  it('requires a reason to reject and a spent amount to end', async () => {
    assert.equal((await post(`/v1/admin/campaigns/${campaignId}/reject`, {})).status, 400);
    assert.equal((await post(`/v1/admin/campaigns/${campaignId}/end`, {})).status, 400);
    assert.equal((await post(`/v1/admin/campaigns/${campaignId}/end`, { spentAmount: 20000, note: 'Meta ads' })).status, 200);
  });
});
