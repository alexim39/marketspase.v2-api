import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverBulkEmail, SendBulkEmailUseCase } from './Outreach.usecases.js';

const fakePartners = (rows = {}) => ({
  findById: async (id) => rows[String(id)] ?? null,
});

const fakeRecords = () => {
  const docs = [];
  return { docs, create: async (doc) => { docs.push(doc); return doc; } };
};

const deps = (over = {}) => ({
  partners: fakePartners({ p1: { _id: 'p1' } }),
  records: fakeRecords(),
  mail: async () => ({ sent: true }),
  ...over,
});

test('deliverBulkEmail sends, records, and reports sent/total', async () => {
  const d = deps();
  let mailedTo = null;
  let mailedHtml = null;
  d.mail = async (to, subject, html) => { mailedTo = to; mailedHtml = html; return { sent: true }; };
  const res = await deliverBulkEmail(d, {
    partnerId: 'p1', to: ['A@x.test'], subject: 'Hi', body: 'Hello there',
  });
  assert.deepEqual({ sent: res.sent, total: res.total, status: res.status }, { sent: 1, total: 1, status: 'success' });
  assert.deepEqual(res.failed, []);
  assert.equal(mailedTo, 'a@x.test');
  assert.match(mailedHtml, /<p style="margin:0 0 1em;">Hello there<\/p>/);
  assert.equal(d.records.docs.length, 1);
  assert.equal(d.records.docs[0].emailSubject, 'Hi');
});

test('deliverBulkEmail counts {sent:false} receipts as failed, not sent', async () => {
  const d = deps({ mail: async () => ({ sent: false, error: 'mailbox down' }) });
  const res = await deliverBulkEmail(d, {
    partnerId: 'p1', to: ['a@x.test'], subject: 'Hi', body: 'Hello',
  });
  assert.equal(res.sent, 0);
  assert.equal(res.status, 'failed');
  assert.equal(res.failed.length, 1);
  assert.match(res.failed[0].error, /mailbox down/);
  assert.equal(d.records.docs.length, 1); // attempt still logged
});

test('deliverBulkEmail rejects unknown partners and invalid emails before sending', async () => {
  let mailed = 0;
  const d = deps({ mail: async () => { mailed += 1; return { sent: true }; } });
  await assert.rejects(
    deliverBulkEmail(d, { partnerId: 'ghost', to: ['a@x.test'], subject: 'Hi', body: 'Hello' }),
    /Partner not found/,
  );
  await assert.rejects(
    deliverBulkEmail(d, { partnerId: 'p1', to: ['not-an-email'], subject: 'Hi', body: 'Hello' }),
    /Invalid email address/,
  );
  assert.equal(mailed, 0);
  assert.equal(d.records.docs.length, 0);
});

test('SendBulkEmailUseCase delegates to the shared core', async () => {
  const d = deps();
  const uc = new SendBulkEmailUseCase(d);
  const res = await uc.execute({ partnerId: 'p1', to: ['a@x.test'], subject: 'S', body: 'B' });
  assert.equal(res.sent, 1);
  assert.equal(res.status, 'success');
});
