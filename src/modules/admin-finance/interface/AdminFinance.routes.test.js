import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildAdminFinanceRouter } from './AdminFinance.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/admin/finance', buildAdminFinanceRouter({
    auth: (req, _res, next) => {
      req.auth = { partnerId: 'admin-1' };
      next();
    },
    admin: (req, _res, next) => {
      if (req.headers['x-test-role'] === 'user') {
        const error = new Error('Insufficient permissions');
        error.statusCode = 403;
        return next(error);
      }
      next();
    },
    usecase: {
      execute: async (input) => ({
        items: [{
          id: 'tx1',
          partnerName: 'Ada Obi',
          amount: 1000,
          method: 'Withdrawal',
          type: 'Debit',
          status: 'Paid',
        }],
        total: 1,
        limit: input.limit,
        skip: input.skip,
        totals: { amount: 1000, count: 1 },
      }),
    },
  }));
  app.use(errorMiddleware);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/v1/admin/finance`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const get = async (path, headers = {}) => {
  const response = await fetch(`${base}${path}`, { headers });
  return { status: response.status, body: await response.json() };
};

describe('admin finance transactions route', () => {
  it('returns deposit and withdrawal rows to an admin', async () => {
    const response = await get('/transactions?type=all&limit=25');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.items[0].partnerName, 'Ada Obi');
    assert.equal(response.body.data.total, 1);
  });

  it('rejects an invalid type or limit', async () => {
    const type = await get('/transactions?type=invalid');
    assert.equal(type.status, 400);
    const limit = await get('/transactions?limit=500');
    assert.equal(limit.status, 400);
  });

  it('blocks a non-admin request', async () => {
    const response = await get('/transactions', { 'x-test-role': 'user' });
    assert.equal(response.status, 403);
  });
});
