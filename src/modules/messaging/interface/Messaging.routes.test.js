import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';
import { setRevocationChecker } from '../../identity-access/infrastructure/SessionRevocation.js';
import { buildMessagingRouter } from './Messaging.routes.js';

before(() => {
  process.env.JWTTOKENSECRET = process.env.JWTTOKENSECRET || 'test-secret-messaging-routes';
  setRevocationChecker(async () => false);
});

const listen = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(buildMessagingRouter({
    // Never hit: every test below fails auth or validation first.
    messages: { async thread() { throw new Error('should not reach store'); } },
    network: { async findNode() { throw new Error('should not reach network'); } },
  }));
  app.use(errorMiddleware);
  return app;
};

const token = () => jwt.sign({ id: 'partner-1' }, process.env.JWTTOKENSECRET);

describe('messaging routes', () => {
  it('rejects unauthenticated sockets of HTTP (401 without token)', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/inbox`);
    assert.equal(res.status, 401);
  });

  it('rejects malformed ids before any store or network touch', async (t) => {
    const app = buildApp();
    const server = await listen(app);
    t.after(() => close(server));
    const { port } = server.address();
    const auth = { authorization: `Bearer ${token()}` };

    const badThread = await fetch(`http://127.0.0.1:${port}/thread/nope`, { headers: auth });
    assert.equal(badThread.status, 400);

    const badRead = await fetch(`http://127.0.0.1:${port}/nope/read`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(badRead.status, 400);

    const badRoute = await fetch(`http://127.0.0.1:${port}/route/nope`, { headers: auth });
    assert.equal(badRoute.status, 400);

    const badSms = await fetch(`http://127.0.0.1:${port}/sms-fallback`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'nope', body: 'hi' }),
    });
    assert.equal(badSms.status, 400);

    const badDirect = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'nope', body: 'hi' }),
    });
    assert.equal(badDirect.status, 400);
  });
});
