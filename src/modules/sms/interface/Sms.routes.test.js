import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { buildSmsRouter } from './Sms.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';
import { setRevocationChecker } from '../../identity-access/infrastructure/SessionRevocation.js';

const PARTNER_ID = '507f1f77bcf86cd799439099';
const RECIPIENT_ID = '507f1f77bcf86cd799439011';
const CAMPAIGN_ID = '507f1f77bcf86cd799439031';

before(() => {
  process.env.JWTTOKENSECRET = process.env.JWTTOKENSECRET || 'test-secret-sms-routes';
  setRevocationChecker(async () => false);
});

const token = () => jwt.sign({ id: PARTNER_ID }, process.env.JWTTOKENSECRET);

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => resolve(server));
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

const calls = [];
const fakeService = {
  recipients: async (partnerId, input) => {
    calls.push(['recipients', partnerId, input]);
    return { type: input.type, items: [], walletBalance: 500, actor: { name: 'Ada' } };
  },
  suggest: async (partnerId, input) => {
    calls.push(['suggest', partnerId, input]);
    return { recipient: { ...input, name: 'Mercy' }, suggestions: [{ intent: 'follow_up', label: 'Follow up', body: 'Hi' }] };
  },
  quote: async (partnerId, input) => {
    calls.push(['quote', partnerId, input]);
    return { pages: 1, recipients: input.recipients.length, cost: 10, canSend: true, walletBalance: 500, previews: [] };
  },
  send: async (partnerId, input) => {
    calls.push(['send', partnerId, input]);
    return { id: CAMPAIGN_ID, status: input.scheduledAt ? 'scheduled' : 'sending', totalCost: 10 };
  },
  history: async (partnerId, input) => {
    calls.push(['history', partnerId, input]);
    return { items: [], total: 0, limit: 20, skip: 0 };
  },
  detail: async (partnerId, id) => {
    calls.push(['detail', partnerId, id]);
    return { id, body: 'Hello', recipients: [] };
  },
  cancel: async (partnerId, id) => {
    calls.push(['cancel', partnerId, id]);
    return { id, status: 'cancelled' };
  },
  retry: async (partnerId, id) => {
    calls.push(['retry', partnerId, id]);
    return { id, status: 'sending' };
  },
  templates: async (partnerId) => {
    calls.push(['templates', partnerId]);
    return [];
  },
  saveTemplate: async (partnerId, id, input) => {
    calls.push(['saveTemplate', partnerId, id, input]);
    return { id: id ?? 'template-1', ...input, system: false };
  },
  deleteTemplate: async (partnerId, id) => {
    calls.push(['deleteTemplate', partnerId, id]);
    return { deleted: true };
  },
  suppressions: async (partnerId) => {
    calls.push(['suppressions', partnerId]);
    return [];
  },
  addSuppression: async (partnerId, input) => {
    calls.push(['addSuppression', partnerId, input]);
    return { id: 'suppression-1', phone: '2348031234567' };
  },
  removeSuppression: async (partnerId, id) => {
    calls.push(['removeSuppression', partnerId, id]);
    return { deleted: true };
  },
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(buildSmsRouter({ service: fakeService }));
  app.use(errorMiddleware);
  return app;
};

const request = async (server, path, { method = 'GET', auth = true, body } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${token()}`;
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

describe('SMS routes', () => {
  let server;

  before(async () => {
    server = await listen(buildApp());
  });

  after(() => close(server));

  it('rejects unauthenticated requests', async () => {
    const res = await request(server, '/recipients', { auth: false });
    assert.equal(res.status, 401);
  });

  it('validates recipient filters and ids before touching the service', async () => {
    const before = calls.length;
    const badType = await request(server, '/recipients?type=everyone');
    assert.equal(badType.status, 400);

    const badSend = await request(server, '/send', {
      method: 'POST',
      body: {
        idempotencyKey: 'test-key-1',
        recipients: [{ type: 'prospect', id: 'not-an-id' }],
        body: 'Hello from Ada.',
      },
    });
    assert.equal(badSend.status, 400);

    const badQuote = await request(server, '/quote', {
      method: 'POST',
      body: { recipients: [], body: 'Hello from Ada.' },
    });
    assert.equal(badQuote.status, 400);
    assert.equal(calls.length, before);
  });

  it('passes the authenticated partner id to every call', async () => {
    const res = await request(server, '/recipients?type=partners&q=jo');
    assert.equal(res.status, 200);
    const call = calls.findLast((row) => row[0] === 'recipients');
    assert.equal(call[1], PARTNER_ID);
    assert.deepEqual(call[2], { type: 'partners', q: 'jo' });
  });

  it('creates a send and returns 201', async () => {
    const res = await request(server, '/send', {
      method: 'POST',
      body: {
        idempotencyKey: 'test-key-2',
        recipients: [{ type: 'prospect', id: RECIPIENT_ID }],
        body: 'Hello {{first_name}}, welcome.',
      },
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.id, CAMPAIGN_ID);
    assert.equal(json.message, 'SMS queued');
    const call = calls.findLast((row) => row[0] === 'send');
    assert.equal(call[1], PARTNER_ID);
    assert.equal(call[2].recipients[0].id, RECIPIENT_ID);
  });

  it('labels a future send as scheduled', async () => {
    const res = await request(server, '/send', {
      method: 'POST',
      body: {
        idempotencyKey: 'test-key-3',
        recipients: [{ type: 'partner', id: RECIPIENT_ID }],
        body: 'Hello from Ada.',
        scheduledAt: '2026-12-01T09:00:00.000Z',
      },
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.message, 'SMS scheduled');
  });

  it('returns a quote with the selected recipients and body', async () => {
    const res = await request(server, '/quote', {
      method: 'POST',
      body: {
        recipients: [{ type: 'prospect', id: RECIPIENT_ID }],
        body: 'Hello from Ada.',
      },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.cost, 10);
  });

  it('supports history filters, detail, cancel and retry', async () => {
    assert.equal((await request(server, '/campaigns?status=sent&limit=10')).status, 200);
    assert.equal((await request(server, `/campaigns/${CAMPAIGN_ID}`)).status, 200);
    assert.equal((await request(server, `/campaigns/${CAMPAIGN_ID}/cancel`, { method: 'POST' })).status, 200);
    assert.equal((await request(server, `/campaigns/${CAMPAIGN_ID}/retry`, { method: 'POST' })).status, 200);
  });

  it('manages templates and opt-outs inside the caller scope', async () => {
    const created = await request(server, '/templates', {
      method: 'POST',
      body: { name: 'Welcome', body: 'Hi {{first_name}}, welcome.' },
    });
    assert.equal(created.status, 201);

    const patched = await request(server, '/templates/507f1f77bcf86cd799439041', {
      method: 'PATCH',
      body: { name: 'Welcome v2', body: 'Hi {{first_name}}, welcome again.' },
    });
    assert.equal(patched.status, 200);

    const optout = await request(server, '/suppressions', {
      method: 'POST',
      body: { phone: '0803 123 4567', reason: 'Asked to stop' },
    });
    assert.equal(optout.status, 201);

    const call = calls.findLast((row) => row[0] === 'addSuppression');
    assert.equal(call[1], PARTNER_ID);
    assert.equal(call[2].phone, '0803 123 4567');
  });
});
