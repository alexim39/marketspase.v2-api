import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildAdminOraRouter } from './AdminOra.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

const CID = '507f1f77bcf86cd799439011';
const calls = [];
const fakeService = {
  overview: async (input) => {
    calls.push(['overview', input]);
    return { conversations: 2, messages: 9, activeUsers: 2, flagged: 1, hidden: 0, actions: { proposed: 1, executed: 2, failed: 0, skipped: 0 }, topics: [], daily: [] };
  },
  listConversations: async (input) => {
    calls.push(['list', input]);
    return {
      items: [{
        id: CID,
        partnerId: 'p1',
        title: 'Getting started',
        messageCount: 2,
        updatedAt: '2026-11-18T00:00:00.000Z',
        partner: { name: 'Ada', username: 'ada', accountState: 'member' },
        moderation: { flagged: false, hidden: false },
        lastMessage: { role: 'assistant', content: 'Welcome', at: null },
      }],
      total: 1,
      limit: input.limit ?? 25,
      skip: input.skip ?? 0,
    };
  },
  conversation: async (id) => {
    calls.push(['detail', id]);
    return { conversation: { id, partnerId: 'p1', messages: [] }, actions: [], events: [], plan: null };
  },
  flag: async (id, input) => {
    calls.push(['flag', id, input]);
    return { id, moderation: { flagged: input.flagged !== false } };
  },
  addNote: async (id, input) => {
    calls.push(['note', id, input]);
    return { id, moderation: { notesCount: 1 } };
  },
  setHidden: async (id, input) => {
    calls.push(['hide', id, input]);
    return { id, moderation: { hidden: input.hidden !== false } };
  },
  listActions: async (input) => {
    calls.push(['actions', input]);
    return { items: [], total: 0, limit: 25, skip: 0 };
  },
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(buildAdminOraRouter({
    service: fakeService,
    audit: async () => null,
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
  }));
  app.use(errorMiddleware);
  return app;
};

const request = async (server, path, { method = 'GET', body, role } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (role) headers['x-test-role'] = role;
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

describe('admin Ora routes', () => {
  let server;
  before(async () => {
    server = await new Promise((resolve) => {
      const app = buildApp();
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('rejects a non-admin request', async () => {
    const res = await request(server, '/conversations', { role: 'user' });
    assert.equal(res.status, 403);
  });

  it('serves overview, conversation list and detail', async () => {
    assert.equal((await request(server, '/overview?days=7')).status, 200);
    const list = await request(server, `/conversations?q=ada&accountState=member&flagged=yes&limit=10`);
    assert.equal(list.status, 200);
    const listJson = await list.json();
    assert.equal(listJson.data.items[0].id, CID);
    assert.equal((await request(server, `/conversations/${CID}`)).status, 200);
    const call = calls.findLast((row) => row[0] === 'list');
    assert.equal(call[1].accountState, 'member');
    assert.equal(call[1].flagged, 'yes');
  });

  it('flags, notes and hides a conversation', async () => {
    const flagged = await request(server, `/conversations/${CID}/flag`, {
      method: 'POST',
      body: { flagged: true, reason: 'Policy review' },
    });
    assert.equal(flagged.status, 200);
    const note = await request(server, `/conversations/${CID}/notes`, {
      method: 'POST',
      body: { note: 'Reviewed with support' },
    });
    assert.equal(note.status, 201);
    const hidden = await request(server, `/conversations/${CID}/hide`, {
      method: 'POST',
      body: { hidden: true, reason: 'Privacy request' },
    });
    assert.equal(hidden.status, 200);
    assert.ok(calls.some((row) => row[0] === 'flag'));
    assert.ok(calls.some((row) => row[0] === 'note'));
    assert.ok(calls.some((row) => row[0] === 'hide'));
  });

  it('serves actions and a CSV export', async () => {
    assert.equal((await request(server, '/actions?status=failed')).status, 200);
    const csv = await request(server, '/export?q=ada');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    const text = await csv.text();
    assert.match(text, /^Partner,Username,Activation/);
    assert.match(text, /Ada/);
  });
});
