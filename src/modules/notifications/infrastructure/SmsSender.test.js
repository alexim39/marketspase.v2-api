import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpSmsSender } from './SmsSender.js';
import { env } from '../../../shared/config/env.js';

const withEnv = (patch, fn) => {
  const previous = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
};

test('BulkSMS token config builds the Bearer header and default endpoint', () => {
  withEnv({
    BULKSMS_API_TOKEN: 'bulk-token',
    BULKSMS_SENDER_ID: 'marketspase',
    SMS_PROVIDER: 'http',
    SMS_HTTP_URL: undefined,
    SMS_HTTP_HEADERS: undefined,
  }, () => {
    const sms = env.sms;
    assert.equal(sms.url, 'https://www.bulksmsnigeria.com/api/v2/sms');
    assert.equal(sms.senderId, 'marketspase');
    assert.equal(sms.headers.Authorization, 'Bearer bulk-token');
    assert.equal(sms.enabled, true);
  });
});

test('HttpSmsSender maps the BulkSMSNigeria payload and response id', async () => {
  let captured = null;
  const sender = new HttpSmsSender({
    url: 'https://www.bulksmsnigeria.com/api/v2/sms',
    headers: { Authorization: 'Bearer token', Accept: 'application/json' },
    senderId: 'marketspase',
    extra: { gateway: 'direct-refund' },
    post: async (url, data, opts) => {
      captured = { url, data, opts };
      return { data: { data: { message_id: 'msg-1' } } };
    },
  });

  const out = await sender.send({ to: '08031234567', body: 'Hello there' });

  assert.equal(captured.url, 'https://www.bulksmsnigeria.com/api/v2/sms');
  assert.equal(captured.data.to, '2348031234567');
  assert.equal(captured.data.from, 'marketspase');
  assert.equal(captured.data.body, 'Hello there');
  assert.equal(captured.data.gateway, 'direct-refund');
  assert.equal(captured.opts.headers.Authorization, 'Bearer token');
  assert.equal(out.providerId, 'msg-1');
});
