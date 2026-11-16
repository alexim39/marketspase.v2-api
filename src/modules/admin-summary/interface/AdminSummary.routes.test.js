import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildAdminSummaryRouter } from './AdminSummary.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/admin/summaries', buildAdminSummaryRouter({
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
    repo: {
      people: async () => ({ domain: 'people', kpis: [], trends: [], distributions: [], alerts: [], window: { days: 30 } }),
      finance: async () => ({ domain: 'finance', kpis: [], trends: [], distributions: [], alerts: [], window: { days: 30 } }),
      commerce: async () => ({ domain: 'commerce', kpis: [], trends: [], distributions: [], alerts: [], window: { days: 30 } }),
      growth: async () => ({ domain: 'growth', kpis: [], trends: [], distributions: [], alerts: [], window: { days: 30 } }),
      support: async () => ({ domain: 'support', kpis: [], trends: [], distributions: [], alerts: [], window: { days: 30 } }),
      content: async () => ({ domain: 'content', kpis: [], trends: [], distributions: [], alerts: [], window: { days: 30 } }),
      communications: async () => ({ domain: 'communications', kpis: [], trends: [], distributions: [], alerts: [], window: { days: 30 } }),
    },
  }));
  app.use(errorMiddleware);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/v1/admin/summaries`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const get = async (path, headers = {}) => {
  const response = await fetch(`${base}${path}`, { headers });
  return { status: response.status, body: await response.json() };
};

describe('admin summary routes', () => {
  it('serves every supported summary domain to an admin', async () => {
    for (const domain of ['people', 'finance', 'commerce', 'growth', 'support', 'content', 'communications']) {
      const response = await get(`/${domain}?days=30`);
      assert.equal(response.status, 200, domain);
      assert.equal(response.body.data.domain, domain);
    }
  });

  it('rejects an unknown domain and invalid window', async () => {
    const unknown = await get('/unknown');
    assert.equal(unknown.status, 400);
    const invalidDays = await get('/people?days=2');
    assert.equal(invalidDays.status, 400);
  });

  it('blocks a non-admin request', async () => {
    const response = await get('/people', { 'x-test-role': 'user' });
    assert.equal(response.status, 403);
  });
});
