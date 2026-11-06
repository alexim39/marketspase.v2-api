import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PaystackClient, verifyPaystackSignature } from './PaystackClient.js';

test('PaystackClient initializes a hosted checkout', async () => {
  const calls = [];
  const http = {
    post: async (url, body, options) => {
      calls.push({ url, body, options });
      return { data: { data: { authorization_url: 'https://checkout.paystack.com/abc', access_code: 'ac_1', reference: body.reference } } };
    },
  };
  const client = new PaystackClient({ secretKey: 'sk_test', http });
  const out = await client.initialize({
    reference: 'DP1', amountKobo: 250000, email: 'a@example.com', callbackUrl: 'https://marketspase.com/result',
  });
  assert.equal(out.authorizationUrl, 'https://checkout.paystack.com/abc');
  assert.equal(calls[0].url, 'https://api.paystack.co/transaction/initialize');
  assert.equal(calls[0].body.amount, 250000);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk_test');
});

test('PaystackClient requests a refund', async () => {
  const calls = [];
  const http = {
    post: async (url, body, options) => {
      calls.push({ url, body, options });
      return { data: { data: { id: 91, status: 'pending', amount: body.amount } } };
    },
  };
  const client = new PaystackClient({ secretKey: 'sk_test', http });
  const refund = await client.refund({ reference: 'MS-1', amountKobo: 115000, reason: 'Item returned' });
  assert.equal(calls[0].url, 'https://api.paystack.co/refund');
  assert.equal(calls[0].body.transaction, 'MS-1');
  assert.equal(calls[0].body.amount, 115000);
  assert.equal(calls[0].body.merchant_note, 'Item returned');
  assert.equal(refund.reference, '91');
  assert.equal(refund.status, 'pending');
  assert.equal(refund.amountKobo, 115000);
});

test('PaystackClient verifies, resolves and lists banks', async () => {  const http = {
    get: async (url, options) => {
      if (url.endsWith('/transaction/verify/REF')) return { data: { data: { status: 'success', amount: 10000 } } };
      if (url.endsWith('/bank/resolve')) return { data: { data: { account_name: 'Ada Obi', account_number: options.params.account_number } } };
      return { data: { data: [{ name: 'GTBank', code: '058' }, { name: 'GTBank alias', code: '058' }, { name: '', code: 'bad' }] } };
    },
  };
  const client = new PaystackClient({ secretKey: 'sk_test', http });
  assert.equal((await client.verify('REF')).status, 'success');
  assert.deepEqual(await client.resolveAccount('0123456789', '058'), { accountName: 'Ada Obi', accountNumber: '0123456789' });
  assert.deepEqual(await client.listBanks(), [{ name: 'GTBank', code: '058' }]);
});

test('PaystackClient creates recipients, starts and verifies transfers', async () => {
  const posts = [];
  const http = {
    post: async (url, body) => {
      posts.push({ url, body });
      if (url.endsWith('/transferrecipient')) {
        return { data: { data: { recipient_code: 'RCP_1', details: { account_name: 'ADA OBI' } } } };
      }
      return {
        data: {
          data: {
            transfer_code: 'TRF_1', status: 'pending', reference: body.reference, amount: body.amount,
          },
        },
      };
    },
    get: async (url) => {
      if (url.endsWith('/transfer/verify/WD1')) {
        return { data: { data: { status: 'success', transfer_code: 'TRF_1' } } };
      }
      return { data: { data: [{ currency: 'NGN', balance: 500000 }] } };
    },
  };
  const client = new PaystackClient({ secretKey: 'sk_test', http });
  const recipient = await client.createTransferRecipient({
    name: 'Ada Obi', accountNumber: '0123456789', bankCode: '058',
  });
  assert.equal(recipient.recipientCode, 'RCP_1');
  const transfer = await client.initiateTransfer({
    recipientCode: 'RCP_1', amountKobo: 100000, reference: 'WD1', reason: 'test',
  });
  assert.equal(transfer.transferCode, 'TRF_1');
  assert.equal(transfer.status, 'pending');
  assert.equal((await client.verifyTransfer('WD1')).status, 'success');
  assert.equal(await client.availableBalanceKobo('NGN'), 500000);

  const recipientCall = posts.find((call) => call.url.endsWith('/transferrecipient'));
  assert.equal(recipientCall.body.account_number, '0123456789');
  assert.equal(recipientCall.body.bank_code, '058');
  assert.equal(recipientCall.body.type, 'nuban');
  const transferCall = posts.find((call) => call.url.endsWith('/transfer'));
  assert.equal(transferCall.body.recipient, 'RCP_1');
  assert.equal(transferCall.body.amount, 100000);
  assert.equal(transferCall.body.source, 'balance');
});

test('Paystack webhook signatures are timing-safe and required', () => {
  const raw = Buffer.from(JSON.stringify({ event: 'charge.success' }));
  const secret = 'sk_test';
  const signature = crypto.createHmac('sha512', secret).update(raw).digest('hex');
  assert.equal(verifyPaystackSignature(raw, signature, secret), true);
  assert.equal(verifyPaystackSignature(raw, 'bad', secret), false);
  assert.equal(verifyPaystackSignature(raw, signature, ''), false);
});
