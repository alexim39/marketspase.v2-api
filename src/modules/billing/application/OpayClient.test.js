import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  OpayClient, hmacSha512Hex, verifyCallbackSignature, callbackSignContent,
  OPAY_TEST_BASE,
} from '../infrastructure/OpayClient.js';

const PRIVATE_KEY = 'OPAYPRV-TEST-KEY-12345';

const samplePayload = () => ({
  amount: '49160',
  channel: 'Web',
  country: 'NG',
  currency: 'NGN',
  displayedFailure: '',
  fee: '737',
  feeCurrency: 'NGN',
  instrumentType: 'BankCard',
  reference: '10023',
  refunded: false,
  status: 'SUCCESS',
  timestamp: '2022-05-07T06:20:46Z',
  token: '220507145660712931829',
  transactionId: '220507145660712931829',
  updated_at: '2022-05-07T07:20:46Z',
});

const signCallback = (payload, key = PRIVATE_KEY) =>
  crypto.createHmac('sha3-512', key).update(callbackSignContent(payload), 'utf8').digest('hex');

describe('callback signature (HMAC-SHA3-512, docs format)', () => {
  it('accepts a correctly signed callback', () => {
    const p = samplePayload();
    assert.equal(verifyCallbackSignature(p, signCallback(p), PRIVATE_KEY), true);
  });

  it('rejects tampered amount / status / reference', () => {
    const p = samplePayload();
    const sig = signCallback(p);
    assert.equal(verifyCallbackSignature({ ...p, amount: '49161' }, sig, PRIVATE_KEY), false);
    assert.equal(verifyCallbackSignature({ ...p, status: 'FAIL' }, sig, PRIVATE_KEY), false);
    assert.equal(verifyCallbackSignature({ ...p, reference: '99999' }, sig, PRIVATE_KEY), false);
  });

  it('rejects wrong keys and encodes refunded as t/f', () => {
    const p = samplePayload();
    assert.equal(verifyCallbackSignature(p, signCallback(p, 'OTHER'), PRIVATE_KEY), false);
    assert.equal(verifyCallbackSignature(p, 'zz', PRIVATE_KEY), false);
    assert.match(callbackSignContent({ ...p, refunded: true }), /Refunded:t/);
    assert.match(callbackSignContent(p), /Refunded:f/);
  });

  it('sha3-512 is available in this runtime', () => {
    assert.ok(crypto.getHashes().includes('sha3-512'));
  });
});

describe('API-call signature (HMAC-SHA512 of raw body)', () => {
  it('matches Node crypto output deterministically', () => {
    const body = JSON.stringify({ reference: 'X1', country: 'NG' });
    const expected = crypto.createHmac('sha512', PRIVATE_KEY).update(body, 'utf8').digest('hex');
    assert.equal(hmacSha512Hex(body, PRIVATE_KEY), expected);
  });
});

describe('OpayClient (mocked transport)', () => {
  const client = (post) => new OpayClient({
    baseUrl: OPAY_TEST_BASE,
    publicKey: 'PUB',
    privateKey: PRIVATE_KEY,
    merchantId: 'MID',
    post,
  });

  it('reports disabled without keys', () => {
    assert.equal(new OpayClient({}).enabled, false);
    assert.equal(client(async () => ({})).enabled, true);
  });

  it('createCashier returns the redirect URL on 00000', async () => {
    const seen = {};
    const c = client(async (url, body, headers) => {
      Object.assign(seen, { url, body, headers });
      return { status: 200, data: { code: '00000', message: 'SUCCESSFUL', data: { cashierUrl: 'https://cashier/x', orderNo: 'O1', status: 'INITIAL' } } };
    });
    const res = await c.createCashier({ reference: 'DP1', amountKobo: 250000, email: 'a@x', name: 'A', phone: '080', userId: 'u1', callbackUrl: 'cb', returnUrl: 'ret', cancelUrl: 'can' });
    assert.equal(res.cashierUrl, 'https://cashier/x');
    assert.equal(seen.headers.Authorization, 'Bearer PUB');
    assert.equal(seen.headers.MerchantId, 'MID');
    assert.equal(seen.body.amount.total, 250000);
  });

  it('createCashier throws on non-00000 (e.g. duplicate reference)', async () => {
    const c = client(async () => ({ status: 200, data: { code: '02004', message: 'the payment reference already exists.' } }));
    await assert.rejects(c.createCashier({ reference: 'DP1', amountKobo: 100 }), /02004/);
  });

  it('signedPost signs the exact bytes with HMAC-SHA512', async () => {
    let seen;
    const c = client(async (url, body, headers) => {
      seen = { url, body, headers };
      return { status: 200, data: { code: '00000', message: 'SUCCESSFUL', data: { status: 'SUCCESS' } } };
    });
    await c.queryStatus('DP1');
    assert.match(seen.url, /cashier\/status$/);
    const expected = crypto.createHmac('sha512', PRIVATE_KEY).update(JSON.stringify({ reference: 'DP1', country: 'NG' }), 'utf8').digest('hex');
    assert.equal(seen.headers.Authorization, `Bearer ${expected}`);
  });
});
