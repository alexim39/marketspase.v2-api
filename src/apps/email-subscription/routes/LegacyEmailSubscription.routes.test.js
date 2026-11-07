import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import legacyRouter from './LegacyEmailSubscription.routes.js';

const app = express();
app.use('/emailSubscription', legacyRouter);

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

describe('temporary email-subscription redirects', () => {
  it('redirects subscribe with 307 so the POST body survives', async () => {
    const response = await fetch(`${baseUrl}/emailSubscription/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
      redirect: 'manual',
    });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), '/v1/email-subscription/subscribe');
  });

  it('redirects confirmation links with 302', async () => {
    const response = await fetch(`${baseUrl}/emailSubscription/confirm/${token}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/v1/email-subscription/confirm/${token}`);
  });

  it('redirects unsubscribe links with 302', async () => {
    const response = await fetch(`${baseUrl}/emailSubscription/unsubscribe/${token}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/v1/email-subscription/unsubscribe/${token}`);
  });
});
