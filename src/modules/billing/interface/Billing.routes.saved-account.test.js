import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildBillingRouter } from './Billing.routes.js';

const PARTNER_ID = '507f1f77bcf86cd799439011';
const ACCOUNT_ID = '507f1f77bcf86cd799439012';
let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/billing', buildBillingRouter({
    auth: (req, _res, next) => {
      req.auth = { partnerId: PARTNER_ID };
      next();
    },
    paystack: { enabled: false },
    http: {},
    savedAccounts: {
      findByPartner: async (partnerId) => (String(partnerId) === PARTNER_ID
        ? {
          id: ACCOUNT_ID,
          bankCode: '058',
          bankName: 'Guaranty Trust Bank',
          accountName: 'Ada Obi',
          accountNumber: '0123456789',
          accountLast4: '6789',
        }
        : null),
      listByPartner: async (partnerId) => (String(partnerId) === PARTNER_ID
        ? [{
          id: ACCOUNT_ID,
          bankCode: '058',
          bankName: 'Guaranty Trust Bank',
          accountName: 'Ada Obi',
          accountNumber: '0123456789',
          accountLast4: '6789',
        }]
        : []),
      remove: async (partnerId, accountId) => ({
        removed: String(partnerId) === PARTNER_ID && String(accountId) === ACCOUNT_ID,
      }),
    },
  }));
  app.use((err, _req, res, _next) => {
    res.status(err?.statusCode || 500).json({ message: err?.message ?? 'Invalid request', success: false });
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('saved payout account route', () => {
  it('returns the signed-in partner saved payout account without caching', async () => {
    const response = await fetch(`${base}/v1/billing/withdrawal-account`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.data.saved, true);
    assert.equal(body.data.account.accountName, 'Ada Obi');
    assert.equal(body.data.account.accountLast4, '6789');
  });

  it('lists the signed-in partner saved payout accounts with the five-account cap', async () => {
    const response = await fetch(`${base}/v1/billing/withdrawal-accounts`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.data.max, 5);
    assert.equal(body.data.accounts.length, 1);
    assert.equal(body.data.accounts[0].accountName, 'Ada Obi');
  });

  it('removes an owned saved payout account', async () => {
    const response = await fetch(`${base}/v1/billing/withdrawal-accounts/${ACCOUNT_ID}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.removed, true);
  });

  it('returns 404 for a saved account owned by someone else', async () => {
    const response = await fetch(`${base}/v1/billing/withdrawal-accounts/507f1f77bcf86cd799439099`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 404);
  });

  it('rejects a malformed account id before the use case', async () => {
    const response = await fetch(`${base}/v1/billing/withdrawal-accounts/not-an-id`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 400);
  });
});
