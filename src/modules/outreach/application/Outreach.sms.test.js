import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliverBulkSms, ListMyEmailsUseCase, ListMySmsUseCase,
} from './Outreach.usecases.js';

const gteMatches = (doc, filter) => Object.entries(filter ?? {}).every(([k, v]) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('$gte' in v) return Number(doc[k]) >= Number(v.$gte);
    if ('$ne' in v) return doc[k] !== v.$ne;
    return false;
  }
  return String(doc[k]) === String(v);
});

const fakePartners = (seed = {}) => {
  const rows = new Map(Object.entries(seed));
  return {
    rows,
    findById: (id) => ({
      select: () => ({ lean: async () => {
        const r = rows.get(String(id));
        return r ? { ...r } : null;
      } }),
    }),
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        const row = [...rows.values()].find((r) => gteMatches(r, filter));
        if (!row) return null;
        if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) row[k] = Number(row[k] ?? 0) + Number(v);
        return { ...row };
      },
    }),
  };
};

const fakeStore = () => {
  const docs = [];
  return {
    docs,
    create: async (doc) => { const d = { _id: `r${docs.length + 1}`, ...doc }; docs.push(d); return { ...d }; },
    find: (filter) => {
      const found = docs.filter((r) => Object.entries(filter ?? {}).every(([k, v]) => String(r[k]) === String(v)));
      const chain = {
        sort: (spec) => {
          const [[key, dir]] = Object.entries(spec ?? { createdAt: -1 });
          found.sort((a, b) => (dir === -1 ? -1 : 1) * (new Date(a[key]) - new Date(b[key])));
          return chain;
        },
        limit: (n) => ({ lean: async () => found.slice(0, n).map((r) => ({ ...r })) }),
        lean: async () => found.map((r) => ({ ...r })),
      };
      return chain;
    },
  };
};

const deps = (over = {}) => ({
  partners: fakePartners({ p1: { _id: 'p1', balance: 1000 } }),
  transactions: fakeStore(),
  records: fakeStore(),
  sms: { sent: [], send: async function ({ to }) { this.sent.push(to); return {}; } },
  ...over,
});

test('deliverBulkSms charges atomically and records with the tx link', async () => {
  const d = deps();
  const res = await deliverBulkSms(
    { partners: d.partners, transactions: d.transactions, records: d.records, sms: d.sms },
    { partnerId: 'p1', to: ['08031234567'], body: 'Hello there' },
  );
  assert.equal(res.sent, 1);
  assert.equal(res.status, 'success');
  assert.equal(d.partners.rows.get('p1').balance, 1000 - res.cost);
  assert.equal(d.records.docs.length, 1);
  assert.equal(d.records.docs[0].transactionId, d.transactions.docs[0]._id);
});

test('deliverBulkSms refuses overdrafts without touching the wallet', async () => {
  const d = deps({ partners: fakePartners({ p1: { _id: 'p1', balance: 1 } }) });
  try {
    await deliverBulkSms(
      { partners: d.partners, transactions: d.transactions, records: d.records, sms: d.sms },
      { partnerId: 'p1', to: ['08031234567'], body: 'Hello there' },
    );
    assert.fail('must throw');
  } catch (err) {
    assert.equal(err.statusCode, 401);
    assert.match(err.message, /Insufficient balance/);
  }
  assert.equal(d.partners.rows.get('p1').balance, 1);
  assert.equal(d.transactions.docs.length, 0);
  assert.equal(d.records.docs.length, 0);
  assert.equal(d.sms.sent.length, 0);
});

test('deliverBulkSms rejects unknown partners before any movement', async () => {
  const d = deps({ partners: fakePartners({}) });
  await assert.rejects(deliverBulkSms(
    { partners: d.partners, transactions: d.transactions, records: d.records, sms: d.sms },
    { partnerId: 'ghost', to: ['08031234567'], body: 'Hello there' },
  ), /Partner not found/);
});

test('mine endpoints are owner-scoped and newest-first', async () => {
  const smsRecords = fakeStore();
  const transactions = fakeStore();
  const emailRecords = fakeStore();
  smsRecords.docs.push(
    { _id: 'a', partnerId: 'p1', transactionId: 't1', createdAt: new Date('2024-01-01') },
    { _id: 'b', partnerId: 'p2', createdAt: new Date('2024-06-01') },
    { _id: 'c', partnerId: 'p1', createdAt: new Date('2024-03-01') },
  );
  transactions.docs.push({ _id: 't1', partnerId: 'p1', amount: 10 });
  emailRecords.docs.push({ _id: 'e1', partnerId: 'p1' }, { _id: 'e2', partnerId: 'p2' });
  const sms = await new ListMySmsUseCase({ records: smsRecords, transactions }).execute({ partnerId: 'p1' });
  assert.deepEqual(sms.map((r) => r._id), ['c', 'a']);
  assert.equal(sms.find((r) => r._id === 'a').transaction.amount, 10);
  assert.equal(sms.find((r) => r._id === 'c').transaction, null);
  const emails = await new ListMyEmailsUseCase({ emailRecords }).execute({ partnerId: 'p1' });
  assert.deepEqual(emails.map((r) => r._id), ['e1']);
});
