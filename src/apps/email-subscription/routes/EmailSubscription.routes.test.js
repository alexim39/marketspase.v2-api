import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildEmailSubscriptionRouter } from './EmailSubscription.routes.js';
import { errorMiddleware } from '../../../shared/http/errorMiddleware.js';

let seen = null;
const app = express();
app.use(express.json());
app.use('/v1/email-subscription', buildEmailSubscriptionRouter({
  subscribe: (req, res) => {
    seen = req.body;
    return res.status(200).json({ success: true });
  },
  confirm: (req, res) => res.status(200).type('html').send(`confirmed:${req.params.token}`),
  unsubscribe: (req, res) => res.status(200).type('html').send(`unsubscribed:${req.params.token}`),
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

const token = 'a'.repeat(64);

describe('v1 email subscription routes', () => {
  it('accepts a valid subscribe body and strips unknown fields', async () => {
    const response = await fetch(`${baseUrl}/v1/email-subscription/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'Ada@Example.com',
        username: 'ada',
        $where: 'x',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(seen.email, 'ada@example.com');
    assert.equal(seen.username, 'ada');
    assert.equal(seen.$where, undefined);
  });

  it('rejects an invalid email', async () => {
    const response = await fetch(`${baseUrl}/v1/email-subscription/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, 'VALIDATION_ERROR');
  });

  it('confirms with a valid token', async () => {
    const response = await fetch(`${baseUrl}/v1/email-subscription/confirm/${token}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `confirmed:${token}`);
  });

  it('rejects a malformed token', async () => {
    const response = await fetch(`${baseUrl}/v1/email-subscription/confirm/short`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, 'VALIDATION_ERROR');
  });
});
