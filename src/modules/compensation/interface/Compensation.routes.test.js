import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  buildAdminCompensationRouter,
  buildCompensationRouter,
} from './Compensation.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

const partnerId = '507f1f77bcf86cd799439011';
const entryId = '507f1f77bcf86cd799439012';

const auth = (req, _res, next) => {
  req.auth = { partnerId, role: 'admin' };
  next();
};

let releasedId = null;
let rankInput = null;
let reportInput = null;
let reconcileInput = null;

const app = express();
app.use(express.json());
app.use('/v1/compensation', buildCompensationRouter({
  auth,
  mine: {
    execute: async () => ({
      partner: { id: partnerId, commissionRank: 'Builder', depth: 2 },
      plan: { rates: [], ranks: [], mentorBonus: { amount: 1000 } },
      summary: { pending: 1658.7, released: 0, pendingCount: 1, releasedCount: 0, mentorPaid: 0 },
      entries: [{ id: entryId, amount: 1658.7, status: 'Pending' }],
      mentorBonuses: [],
    }),
  },
}));
app.use('/v1/admin/compensation', buildAdminCompensationRouter({
  auth,
  admin: (_req, _res, next) => next(),
  recordAudit: async () => null,
  listEntries: {
    execute: async (query) => ({
      data: [{ id: entryId, amount: 1658.7, status: 'Pending' }],
      meta: { page: query.page, limit: query.limit, total: 1, pages: 1 },
    }),
  },
  release: {
    execute: async (id) => {
      releasedId = id;
      return { released: true, repeated: false, entry: { id, amount: 1658.7 } };
    },
  },
  voidEntry: {
    execute: async (id, _admin, reason) => ({ voided: true, repeated: false, entry: { id, reason } }),
  },
  listBonuses: {
    execute: async () => ({
      data: [{ id: 'bonus-1', amount: 1000, status: 'scheduled' }],
      meta: { page: 1, limit: 25, total: 1, pages: 1 },
    }),
  },
  runBonuses: {
    execute: async () => ({ checked: 2, paid: 1, forfeited: 0, held: 1, failed: 0 }),
  },
  setRank: {
    execute: async (payload) => {
      rankInput = payload;
      return {
        id: partnerId,
        commissionRank: payload.rank,
        commissionRankSource: 'admin',
        commissionRankReason: payload.reason ?? '',
        commissionRankOverrideUntil: payload.overrideUntil ?? null,
      };
    },
  },
  reporting: {
    report: async (query) => {
      reportInput = query;
      return {
        range: { from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' },
        summary: { orders: 2, revenue: 30000, released: 1200 },
        bySaleMode: [],
        byProduct: [],
        problems: [],
        problemCounts: { missing_accrual: 0, fulfilled_not_released: 0, cancelled_not_voided: 0 },
        meta: { orders: 2, truncated: false },
      };
    },
    reconcile: async (body) => {
      reconcileInput = body;
      return {
        dryRun: !body.apply,
        scanned: 5,
        missing: 2,
        missingTotal: 2,
        repaired: body.apply ? 2 : 0,
        failed: 0,
        failures: [],
        samples: [],
      };
    },
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

const request = async (path, method = 'GET', body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
};

describe('compensation partner routes', () => {
  it('serves the plan and the signed-in member ledger', async () => {
    const plan = await request('/v1/compensation/plan');
    const mine = await request('/v1/compensation/me');

    assert.equal(plan.status, 200);
    assert.equal(plan.body.data.mentorBonus.amount, 1000);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.partner.commissionRank, 'Builder');
    assert.equal(mine.body.data.entries[0].status, 'Pending');
  });
});

describe('compensation admin routes', () => {
  it('lists pending commissions and releases one', async () => {
    const list = await request('/v1/admin/compensation/entries?status=Pending');
    const released = await request(`/v1/admin/compensation/entries/${entryId}/release`, 'POST', {});

    assert.equal(list.status, 200);
    assert.equal(list.body.data[0].status, 'Pending');
    assert.equal(released.status, 200);
    assert.equal(releasedId, entryId);
  });

  it('requires a reason to void a commission', async () => {
    assert.equal((await request(`/v1/admin/compensation/entries/${entryId}/void`, 'POST', {})).status, 400);
    assert.equal((await request(`/v1/admin/compensation/entries/${entryId}/void`, 'POST', { reason: 'Refund' })).status, 200);
  });

  it('lists and runs mentor bonuses', async () => {
    const list = await request('/v1/admin/compensation/mentor-bonuses');
    const run = await request('/v1/admin/compensation/mentor-bonuses/run', 'POST', {});

    assert.equal(list.status, 200);
    assert.equal(list.body.data[0].amount, 1000);
    assert.equal(run.status, 200);
    assert.equal(run.body.data.paid, 1);
  });

  it('sets a commission rank by username or email and validates the rank', async () => {
    const ok = await request('/v1/admin/compensation/partners/rank', 'PATCH', {
      identifier: 'ada@example.com',
      rank: 'Leader',
      reason: 'Pilot review',
      overrideUntil: '2026-12-31',
    });
    const bad = await request('/v1/admin/compensation/partners/rank', 'PATCH', {
      identifier: 'ada@example.com',
      rank: 'Diamond',
    });

    assert.equal(ok.status, 200);
    assert.equal(rankInput.rank, 'Leader');
    assert.equal(rankInput.reason, 'Pilot review');
    assert.equal(rankInput.overrideUntil, '2026-12-31');
    assert.equal(bad.status, 400);
  });

  it('serves the product commission report and validates dates', async () => {
    const ok = await request('/v1/admin/compensation/product-report?from=2026-01-01&to=2026-03-01');
    const bad = await request('/v1/admin/compensation/product-report?from=not-a-date');

    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.summary.orders, 2);
    assert.equal(reportInput.from, '2026-01-01');
    assert.equal(bad.status, 400);
  });

  it('runs product reconciliation as a dry run unless apply is true', async () => {
    const scan = await request('/v1/admin/compensation/product-reconcile', 'POST', {});
    const apply = await request('/v1/admin/compensation/product-reconcile', 'POST', { apply: true });

    assert.equal(scan.status, 200);
    assert.equal(scan.body.data.dryRun, true);
    assert.equal(scan.body.data.repaired, 0);
    assert.equal(apply.status, 200);
    assert.equal(apply.body.data.dryRun, false);
    assert.equal(apply.body.data.repaired, 2);
    assert.equal(reconcileInput.apply, true);
  });
});
