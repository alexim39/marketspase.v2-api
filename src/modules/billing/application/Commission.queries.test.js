import test from 'node:test';
import assert from 'node:assert/strict';
import { ListBanksUseCase } from './Commission.queries.js';

test('ListBanksUseCase maps the Paystack directory', async () => {
  const previous = process.env.PAYSTACKTOKEN;
  process.env.PAYSTACKTOKEN = 'sk_test';
  try {
    const uc = new ListBanksUseCase({
      http: {
        get: async (url, options) => {
          assert.match(url, /api\.paystack\.co\/bank$/);
          assert.equal(options.headers.Authorization, 'Bearer sk_test');
          return { data: { data: [{ name: 'GTBank', code: '058' }, { name: '', code: 'bad' }] } };
        },
      },
    });
    assert.deepEqual(await uc.execute(), [{ name: 'GTBank', code: '058' }]);
  } finally {
    if (previous === undefined) delete process.env.PAYSTACKTOKEN;
    else process.env.PAYSTACKTOKEN = previous;
  }
});

test('ListBanksUseCase fails honestly without a provider key', async () => {
  const previous = process.env.PAYSTACKTOKEN;
  delete process.env.PAYSTACKTOKEN;
  try {
    const uc = new ListBanksUseCase({ http: { get: async () => ({}) } });
    await assert.rejects(uc.execute(), (error) => error.statusCode === 500 && error.code === 'CONFIG_ERROR');
  } finally {
    if (previous !== undefined) process.env.PAYSTACKTOKEN = previous;
  }
});

test('ListBanksUseCase wraps provider failures as 502', async () => {
  const previous = process.env.PAYSTACKTOKEN;
  process.env.PAYSTACKTOKEN = 'sk_test';
  try {
    const uc = new ListBanksUseCase({ http: { get: async () => { throw new Error('network'); } } });
    await assert.rejects(uc.execute(), (error) => error.statusCode === 502 && error.code === 'PROVIDER_ERROR');
  } finally {
    if (previous === undefined) delete process.env.PAYSTACKTOKEN;
    else process.env.PAYSTACKTOKEN = previous;
  }
});
