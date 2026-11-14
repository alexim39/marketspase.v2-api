import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildBillingRouter } from './Billing.routes.js';
import { AppError } from '../../../shared/domain/AppError.js';

let withdrawals = 0;
let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1/billing', buildBillingRouter({
    auth: (req, _res, next) => {
      req.auth = { partnerId: 'p1' };
      next();
    },
    paystack: {},
    http: {},
    confirmPassword: {
      execute: async ({ password }) => {
        if (password !== 'secret') {
          throw new AppError(
            'Incorrect password. The withdrawal was not started.',
            422,
            'INVALID_PASSWORD',
          );
        }
      },
    },
    createWithdrawal: {
      execute: async (input) => {
        withdrawals += 1;
        return {
          reference: 'WD1',
          amountNgn: input.amountNgn,
          status: 'Pending',
          balance: 4000,
          bank: 'Guaranty Trust Bank',
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          accountName: 'Ada Obi',
          payoutMode: 'automatic',
        };
      },
    },
  }));
  app.use((err, _req, res, _next) => {
    res.status(err?.statusCode ?? 500).json({
      message: err?.message ?? 'Invalid request',
      code: err?.code ?? 'ERROR',
      success: false,
    });
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/v1/billing/withdrawals`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = async (body) => {
  const response = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const withdrawal = {
  bankCode: '058',
  accountNumber: '0123456789',
  amountNgn: 1000,
};

describe('withdrawal password confirmation', () => {
  it('requires the password field in the request', async () => {
    const before = withdrawals;
    const response = await post(withdrawal);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
    assert.equal(withdrawals, before);
  });

  it('rejects a wrong password before creating the withdrawal', async () => {
    const before = withdrawals;
    const response = await post({ ...withdrawal, password: 'wrong' });
    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'INVALID_PASSWORD');
    assert.equal(withdrawals, before);
  });

  it('creates the withdrawal only after the password matches', async () => {
    const response = await post({ ...withdrawal, password: 'secret' });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.reference, 'WD1');
    assert.equal(withdrawals, 1);
  });
});
