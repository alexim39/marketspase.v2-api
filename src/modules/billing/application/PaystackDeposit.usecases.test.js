import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  InitPaystackDepositUseCase, HandlePaystackWebhookUseCase, creditPaystackIntent,
} from './PaystackDeposit.usecases.js';
import { HandlePaystackTransferUseCase } from './PaystackPayout.usecases.js';
import { CreateWithdrawalUseCase } from './Withdrawal.usecases.js';

test('InitPaystackDepositUseCase creates a pending checkout intent', async () => {
  let created;
  let updated;
  const deposits = {
    create: async (doc) => { created = { ...doc, _id: 'd1' }; return created; },
    findByIdAndUpdate: async (id, update) => {
      updated = update.$set;
      const doc = { _id: id, ...update.$set };
      return { ...doc, lean: async () => doc };
    },
    updateOne: async () => ({}),
  };
  const partners = {
    findById: () => ({ select: () => ({ lean: async () => ({ name: 'Ada', surname: 'Obi', email: 'ada@example.com', phone: '0801' }) }) }),
  };
  const paystack = {
    enabled: true,
    initialize: async (input) => ({ authorizationUrl: 'https://checkout.paystack.com/abc', accessCode: 'ac_1', reference: input.reference }),
  };
  const uc = new InitPaystackDepositUseCase({ deposits, partners, paystack, urls: { returnUrl: 'https://marketspase.com/result' } });
  const out = await uc.execute({ partnerId: 'p1', amountNgn: 2500 });
  assert.equal(out.checkoutUrl, 'https://checkout.paystack.com/abc');
  assert.equal(out.amountNgn, 2500);
  assert.equal(created.method, 'paystack');
  assert.equal(created.amountKobo, 250000);
  assert.equal(updated.status, 'pending');
  assert.equal(updated.accessCode, 'ac_1');
});

test('InitPaystackDepositUseCase refuses without a configured key', async () => {
  const uc = new InitPaystackDepositUseCase({ paystack: { enabled: false } });
  await assert.rejects(uc.execute({ partnerId: 'p1', amountNgn: 2500 }), (err) => err.code === 'PAYSTACK_DISABLED');
});

test('HandlePaystackWebhookUseCase rejects a bad signature before any work', async () => {
  const paystack = { secretKey: 'sk_test', verify: async () => ({ status: 'success' }) };
  const uc = new HandlePaystackWebhookUseCase({ paystack });
  await assert.rejects(
    uc.execute({ payload: { event: 'charge.success', data: { reference: 'DP1' } }, rawBody: Buffer.from('{}'), signature: 'bad' }),
    (err) => err.code === 'BAD_SIGNATURE',
  );
});

test('HandlePaystackWebhookUseCase hands unknown references to the store handler', async () => {
  const payload = { event: 'charge.success', data: { reference: 'MS-STORE-1' } };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha512', 'sk_test').update(rawBody).digest('hex');
  let received = null;
  const uc = new HandlePaystackWebhookUseCase({
    deposits: { findOne: () => ({ lean: async () => null }) },
    paystack: { secretKey: 'sk_test', verify: async () => ({ status: 'success' }) },
    storeOrderHandler: {
      execute: async (input) => {
        received = input;
        return { handled: true, status: 'paid', reference: input.payload.data.reference };
      },
    },
  });

  const out = await uc.execute({ payload, rawBody, signature });
  assert.equal(received.payload.data.reference, 'MS-STORE-1');
  assert.equal(out.handled, true);
  assert.equal(out.status, 'paid');
});

test('creditPaystackIntent treats an already-credited intent as a no-op', async () => {
  const deposits = { findOneAndUpdate: () => ({ lean: async () => null }) };
  const out = await creditPaystackIntent({
    deposits, intent: { _id: 'd1', reference: 'DP1' }, payload: {},
  });
  assert.equal(out.status, 'success');
  assert.equal(out.deduped, true);
});

test('creditPaystackIntent propagates DB failures so the provider retries', async () => {
  const deposits = {
    findOneAndUpdate: () => { throw new Error('db down'); },
  };
  await assert.rejects(
    creditPaystackIntent({ deposits, intent: { _id: 'd1', reference: 'DP1' }, payload: {} }),
    /db down/,
  );
});

test('CreateWithdrawalUseCase (manual mode) debits and stores the resolved name', async () => {
  const partners = {
    findOneAndUpdate: async () => ({ _id: 'p1', balance: 4000 }),
  };
  const transactions = {
    create: async ([doc]) => [{ ...doc, _id: 't1' }],
  };
  const paystack = {
    enabled: true,
    resolveAccount: async () => ({ accountName: 'Ada Obi', accountNumber: '0123456789' }),
    listBanks: async () => [{ name: 'Guaranty Trust Bank', code: '058' }],
  };
  const uc = new CreateWithdrawalUseCase({ partners, transactions, paystack, autoPayout: false });
  const out = await uc.execute({
    partnerId: 'p1', bankCode: '058', bankName: 'Client supplied label', accountNumber: '0123456789', amountNgn: 1000,
  });
  assert.equal(out.status, 'Pending');
  assert.equal(out.payoutMode, 'manual');
  assert.equal(out.accountName, 'Ada Obi');
  assert.equal(out.bank, 'Guaranty Trust Bank');
  assert.equal(out.balance, 4000);
  assert.match(out.reference, /^WD/);
});

test('CreateWithdrawalUseCase starts an automatic Paystack transfer', async () => {
  const created = [];
  const partners = {
    findOneAndUpdate: async () => ({ _id: 'p1', balance: 4000 }),
  };
  const transactions = {
    create: async ([doc]) => { created.push(doc); return [{ ...doc, _id: 't1' }]; },
    findOneAndUpdate: async (id, update) => ({ _id: 't1', ...update.$set }),
    findById: () => ({ select: () => ({ lean: async () => null }) }),
  };
  const paystack = {
    enabled: true,
    resolveAccount: async () => ({ accountName: 'Ada Obi', accountNumber: '0123456789' }),
    listBanks: async () => [{ name: 'Guaranty Trust Bank', code: '058' }],
    availableBalanceKobo: async () => 1_000_000,
    createTransferRecipient: async () => ({ recipientCode: 'RCP_1' }),
    initiateTransfer: async () => ({
      transferCode: 'TRF_1', status: 'pending', reference: 'WD1', amountKobo: 100000,
    }),
  };
  const uc = new CreateWithdrawalUseCase({ partners, transactions, paystack });
  const out = await uc.execute({
    partnerId: 'p1', bankCode: '058', bankName: 'Guaranty Trust Bank', accountNumber: '0123456789', amountNgn: 1000,
  });
  assert.equal(out.status, 'Pending');
  assert.equal(out.payoutMode, 'automatic');
  assert.equal(out.transferStatus, 'pending');
  assert.equal(out.transferCode, 'TRF_1');
  assert.equal(created[0].payoutMode, 'automatic');
  assert.equal(created[0].transferRecipientCode, 'RCP_1');
  assert.equal(created[0].transferStatus, 'processing');
});

test('CreateWithdrawalUseCase refuses when the payout balance is short', async () => {
  let created = 0;
  const paystack = {
    enabled: true,
    resolveAccount: async () => ({ accountName: 'Ada Obi', accountNumber: '0123456789' }),
    listBanks: async () => [{ name: 'Guaranty Trust Bank', code: '058' }],
    availableBalanceKobo: async () => 1000,
  };
  const uc = new CreateWithdrawalUseCase({
    partners: { findOneAndUpdate: async () => { throw new Error('must not debit'); } },
    transactions: { create: async () => { created += 1; return []; } },
    paystack,
  });
  await assert.rejects(
    uc.execute({ partnerId: 'p1', bankCode: '058', bankName: 'GTBank', accountNumber: '0123456789', amountNgn: 1000 }),
    /temporarily unavailable/,
  );
  assert.equal(created, 0);
});

test('CreateWithdrawalUseCase refunds when Paystack cannot start the transfer', async () => {
  const created = [];
  let refunds = 0;
  const partners = {
    findOneAndUpdate: async () => ({ _id: 'p1', balance: 4000 }),
    updateOne: async () => { refunds += 1; return {}; },
  };
  const transactions = {
    create: async ([doc]) => {
      created.push(doc);
      return [{ ...doc, _id: created.length === 1 ? 't1' : 't2' }];
    },
    findOneAndUpdate: async (_filter, update) => ({
      _id: 't1', partnerId: 'p1', amount: 1000, ...update.$set,
    }),
  };
  const paystack = {
    enabled: true,
    resolveAccount: async () => ({ accountName: 'Ada Obi', accountNumber: '0123456789' }),
    listBanks: async () => [{ name: 'Guaranty Trust Bank', code: '058' }],
    availableBalanceKobo: async () => 1_000_000,
    createTransferRecipient: async () => ({ recipientCode: 'RCP_1' }),
    initiateTransfer: async () => { throw new Error('Paystack could not start the payout'); },
    verifyTransfer: async () => { throw new Error('not found'); },
  };
  const uc = new CreateWithdrawalUseCase({ partners, transactions, paystack });
  await assert.rejects(
    uc.execute({ partnerId: 'p1', bankCode: '058', bankName: 'GTBank', accountNumber: '0123456789', amountNgn: 1000 }),
    /wallet was refunded/,
  );
  assert.equal(refunds, 1);
  assert.equal(created.length, 2);
  assert.equal(created[1].paymentMethod, 'Withdrawal Refund');
});

test('HandlePaystackWebhookUseCase forwards transfer events after signature verification', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { reference: 'WD1' } }));
  const signature = crypto.createHmac('sha512', 'sk_test').update(raw).digest('hex');
  let seen = null;
  const transferHandler = {
    execute: async ({ payload }) => { seen = payload.event; return { status: 'paid' }; },
  };
  const uc = new HandlePaystackWebhookUseCase({
    paystack: { secretKey: 'sk_test' },
    transferHandler,
  });
  const out = await uc.execute({
    payload: { event: 'transfer.success', data: { reference: 'WD1' } },
    rawBody: raw,
    signature,
  });
  assert.equal(out.status, 'paid');
  assert.equal(seen, 'transfer.success');
});

test('transfer.success marks an automatic withdrawal paid exactly once', async () => {
  let claimed = false;
  const transactions = {
    findOne: () => ({
      lean: async () => ({
        _id: 't1', partnerId: 'p1', amount: 1000, reference: 'WD1', status: 'Pending',
        payoutMode: 'automatic', bank: 'GTBank', accountName: 'Ada Obi',
      }),
    }),
    findOneAndUpdate: async () => {
      claimed = true;
      return {
        _id: 't1', partnerId: 'p1', amount: 1000, reference: 'WD1', status: 'Paid',
        bank: 'GTBank', accountName: 'Ada Obi', transferCode: 'TRF_1',
      };
    },
  };
  const seen = [];
  const uc = new HandlePaystackTransferUseCase({
    transactions,
    partners: {},
    notifier: async (payload) => { seen.push(payload); },
  });
  const out = await uc.execute({
    payload: { event: 'transfer.success', data: { reference: 'WD1', transfer_code: 'TRF_1' } },
  });
  assert.equal(out.status, 'paid');
  assert.equal(claimed, true);
  assert.equal(seen[0].outcome, 'paid');
});

test('transfer.failed rejects the withdrawal and refunds the wallet', async () => {
  let refund = null;
  const transactions = {
    findOne: () => ({
      lean: async () => ({
        _id: 't1', partnerId: 'p1', amount: 1000, reference: 'WD1', status: 'Pending',
        payoutMode: 'automatic', bank: 'GTBank', accountName: 'Ada Obi',
      }),
    }),
    findOneAndUpdate: async (_filter, update) => ({
      _id: 't1', partnerId: 'p1', amount: 1000, reference: 'WD1', ...update.$set,
    }),
    create: async ([doc]) => { refund = doc; return [doc]; },
  };
  const partners = { updateOne: async () => ({}) };
  const seen = [];
  const uc = new HandlePaystackTransferUseCase({
    transactions,
    partners,
    notifier: async (payload) => { seen.push(payload); },
  });
  const out = await uc.execute({
    payload: { event: 'transfer.failed', data: { reference: 'WD1', gateway_response: 'Declined' } },
  });
  assert.equal(out.status, 'refunded');
  assert.equal(refund.paymentMethod, 'Withdrawal Refund');
  assert.equal(refund.amount, 1000);
  assert.equal(seen[0].outcome, 'refunded');
});

test('transfer events for an already-terminal withdrawal are deduped', async () => {
  const transactions = {
    findOne: () => ({
      lean: async () => ({
        _id: 't1', partnerId: 'p1', amount: 1000, reference: 'WD1', status: 'Paid',
        payoutMode: 'automatic',
      }),
    }),
  };
  let notified = false;
  const uc = new HandlePaystackTransferUseCase({
    transactions,
    partners: {},
    notifier: async () => { notified = true; },
  });
  const out = await uc.execute({
    payload: { event: 'transfer.success', data: { reference: 'WD1' } },
  });
  assert.equal(out.status, 'deduped');
  assert.equal(notified, false);
});

test('transfer.reversed after Paid flags the row without clawing back the wallet', async () => {
  let updated = null;
  const transactions = {
    findOne: () => ({
      lean: async () => ({
        _id: 't1', partnerId: 'p1', amount: 1000, reference: 'WD1', status: 'Paid',
        payoutMode: 'automatic', bank: 'GTBank', accountName: 'Ada Obi',
      }),
    }),
    updateOne: async (_filter, update) => { updated = update.$set; return {}; },
  };
  const seen = [];
  const uc = new HandlePaystackTransferUseCase({
    transactions,
    partners: {},
    notifier: async (payload) => { seen.push(payload); },
  });
  const out = await uc.execute({
    payload: { event: 'transfer.reversed', data: { reference: 'WD1', gateway_response: 'Bank reversal' } },
  });
  assert.equal(out.status, 'reversed');
  assert.equal(updated.transferStatus, 'reversed');
  assert.equal(seen[0].outcome, 'reversed');
});

test('CreateWithdrawalUseCase refuses insufficient balance and bad accounts', async () => {
  const paystack = { enabled: true, resolveAccount: async () => ({ accountName: 'Ada Obi', accountNumber: '0123456789' }) };
  const uc = new CreateWithdrawalUseCase({
    partners: { findOneAndUpdate: async () => null },
    transactions: { create: async () => [] },
    paystack,
    autoPayout: false,
  });
  await assert.rejects(
    uc.execute({ partnerId: 'p1', bankCode: '058', bankName: 'GTBank', accountNumber: '0123456789', amountNgn: 1000 }),
    (err) => err.statusCode === 409,
  );

  const bad = new CreateWithdrawalUseCase({
    partners: { findOneAndUpdate: async () => ({ balance: 100 }) },
    transactions: { create: async () => [] },
    paystack,
    autoPayout: false,
  });
  await assert.rejects(
    bad.execute({ partnerId: 'p1', bankCode: '058', bankName: 'GTBank', accountNumber: '123', amountNgn: 100 }),
    (err) => err.statusCode === 400,
  );
});
