import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildMentorHandoffRouter } from './MentorHandoff.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';
import { ForbiddenException } from '../../../shared/domain/AppError.js';

const mentorId = 'a'.repeat(24);
const memberId = 'b'.repeat(24);
const handoffId = 'c'.repeat(24);

const seen = { send: [], preference: [] };
const task = {
  id: handoffId,
  partnerId: memberId,
  mentorId,
  preference: 'in_app',
  status: 'pending',
  member: { id: memberId, name: 'Bola Ade' },
  contact: {},
  canContact: true,
};

const app = express();
app.use(express.json());
app.use('/v1/mentor-handoffs', buildMentorHandoffRouter({
  auth: (req, _res, next) => {
    req.auth = { partnerId: mentorId };
    next();
  },
  list: {
    execute: async (ownerId, query) => [{ ...task, mentorId: ownerId, status: query.status ?? 'pending' }],
  },
  templates: {
    execute: () => [
      { key: 'welcome_first_step', label: 'Warm welcome', subject: 'Welcome', body: 'Hi {{memberName}}' },
    ],
  },
  send: {
    execute: async (input) => {
      seen.send.push(input);
      if (input.templateKey === 'blocked') {
        throw new ForbiddenException('This member asked not to be contacted yet');
      }
      return {
        handoff: { ...task, status: 'contacted' },
        templateKey: input.templateKey,
        channels: { chat: true, email: true, sms: true },
      };
    },
  },
  contacted: {
    execute: async (input) => {
      seen.send.push(input);
      return { ...task, status: 'contacted' };
    },
  },
  preference: {
    execute: async (input) => {
      seen.preference.push(input);
      return { preference: input.preference, consentAt: null };
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

const request = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

describe('mentor handoff routes', () => {
  it('lists this mentor’s tasks with an optional status filter', async () => {
    const result = await request('/v1/mentor-handoffs?status=pending');

    assert.equal(result.status, 200);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].mentorId, mentorId);
    assert.equal(result.body.data[0].status, 'pending');
  });

  it('serves the approved template catalogue', async () => {
    const result = await request('/v1/mentor-handoffs/templates');

    assert.equal(result.status, 200);
    assert.equal(result.body.data[0].key, 'welcome_first_step');
  });

  it('sends an approved template and reports every channel', async () => {
    const result = await request(`/v1/mentor-handoffs/${handoffId}/send`, {
      method: 'POST',
      body: { templateKey: 'welcome_first_step' },
    });

    assert.equal(result.status, 200);
    assert.equal(seen.send.at(-1).mentorId, mentorId);
    assert.equal(seen.send.at(-1).handoffId, handoffId);
    assert.equal(result.body.data.channels.email, true);
    assert.match(result.body.message, /email, SMS and Chat/);
  });

  it('blocks sending when the member opted out', async () => {
    const result = await request(`/v1/mentor-handoffs/${handoffId}/send`, {
      method: 'POST',
      body: { templateKey: 'blocked' },
    });

    assert.equal(result.status, 403);
    assert.match(result.body.message, /not to be contacted/);
  });

  it('rejects a free-form template key before the use case', async () => {
    const before = seen.send.length;
    const result = await request(`/v1/mentor-handoffs/${handoffId}/send`, {
      method: 'POST',
      body: {},
    });

    assert.equal(result.status, 400);
    assert.equal(seen.send.length, before);
  });

  it('saves a preference and rejects an unknown one', async () => {
    const saved = await request('/v1/mentor-handoffs/preference', {
      method: 'PATCH',
      body: { preference: 'email', consent: true },
    });
    assert.equal(saved.status, 200);
    assert.equal(seen.preference.at(-1).preference, 'email');
    assert.equal(seen.preference.at(-1).consent, true);

    const rejected = await request('/v1/mentor-handoffs/preference', {
      method: 'PATCH',
      body: { preference: 'fax' },
    });
    assert.equal(rejected.status, 400);
  });

  it('marks a task contacted with a note', async () => {
    const result = await request(`/v1/mentor-handoffs/${handoffId}/contacted`, {
      method: 'POST',
      body: { note: 'Caught up on WhatsApp' },
    });

    assert.equal(result.status, 200);
    assert.equal(seen.send.at(-1).note, 'Caught up on WhatsApp');
    assert.equal(result.body.data.status, 'contacted');
  });

  it('rejects a malformed task id', async () => {
    const result = await request('/v1/mentor-handoffs/not-an-id/contacted', {
      method: 'POST',
      body: {},
    });

    assert.equal(result.status, 400);
  });
});
