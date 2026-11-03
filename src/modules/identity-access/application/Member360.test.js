import test from 'node:test';
import assert from 'node:assert/strict';
import { GetMember360UseCase } from './Member360.usecase.js';

const NOW = new Date('2026-09-18T12:00:00Z').getTime();
const daysAgo = (d) => new Date(NOW - d * 86400000);

const member = (over = {}) => ({
  _id: 'p9', name: 'Ada', surname: 'T', email: 'a@x.test', phone: '08031234567',
  username: 'adat', role: 'User', balance: 500, createdAt: daysAgo(60),
  lastLoginAt: daysAgo(2), loginCount: 12, lastLoginIp: '1.2.3.4',
  lastLoginAgent: 'Mozilla/5.0 (Windows NT 10.0)',
  address: { state: 'Lagos' }, suspendedAt: null, partnerOf: 'u1',
  ...over,
});

const deps = (over = {}) => ({
  partners: {
    findById: async (id) => {
      if (String(id) === 'p9') return { ...member() };
      if (String(id) === 'u1') return { _id: 'u1', name: 'Up', surname: 'Line', username: 'upline' };
      return null;
    },
  },
  transactions: {
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [
      { amount: 2500, transactionType: 'Credit', paymentMethod: 'Opay Deposit', status: 'Completed', createdAt: daysAgo(3) },
      { amount: 250, transactionType: 'Debit', paymentMethod: 'Lead Claim', status: 'Completed', createdAt: daysAgo(2) },
    ] }) }) }),
    countDocuments: async () => 2,
  },
  deposits: { countDocuments: async () => 1 },
  prospects: {
    countDocuments: async () => 4,
    find: () => ({ select: () => ({ lean: async () => [{ rating: { score: 5 } }, { rating: { score: 3 } }] }) }),
  },
  progress: { levelsFor: async () => ({ p9: 'kingsman' }) },
  ...over,
});

test('360 composes identity, login, money, growth, journey, upline and risks', async () => {
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    const uc = new GetMember360UseCase(deps());
    const res = await uc.execute({ requesterId: 'admin1', partnerId: 'p9' });
    assert.equal(res.identity.name, 'Ada T');
    assert.equal(res.identity.phone, '08031234567');
    assert.equal(res.login.daysSinceLogin, 2);
    assert.equal(res.login.neverSeen, false);
    assert.equal(res.login.lastAgent, 'Desktop browser');
    assert.equal(res.money.balance, 500);
    assert.equal(res.money.in30d, 2500);
    assert.equal(res.money.txCount, 2);
    assert.equal(res.growth.activeLeads, 4);
    assert.equal(res.growth.rating, 4);
    assert.equal(res.journey.level, 'kingsman');
    assert.equal(res.upline.username, 'upline');
    assert.deepEqual(res.risks, []);
  } finally {
    Date.now = realNow;
  }
});

test('flags never-seen, dormant, suspended, wallet-thin and missing phone', async () => {
  const d = deps({
    partners: {
      findById: async (id) => {
        if (String(id) !== 'p9') return null;
        return {
          ...member({
            lastLoginAt: null, loginCount: 0, suspendedAt: new Date(), suspendReason: 'spam',
            phone: '', balance: 100,
          }),
        };
      },
    },
    prospects: {
      countDocuments: async () => 3,
      find: () => ({ select: () => ({ lean: async () => [] }) }),
    },
  });
  const res = await new GetMember360UseCase(d).execute({ requesterId: 'admin1', partnerId: 'p9' });
  const labels = res.risks.map((r) => r.label);
  assert.ok(labels.includes('Never signed in'));
  assert.ok(labels.includes('Suspended'));
  assert.ok(labels.includes('Low wallet for claims'));
  assert.ok(labels.includes('No phone on file'));
  assert.equal(res.identity.suspended, true);
});

test('guards self-view and unknown members; sections degrade, never 500', async () => {
  const uc = new GetMember360UseCase(deps());
  await assert.rejects(uc.execute({ requesterId: 'p9', partnerId: 'p9' }), /own record/);
  await assert.rejects(uc.execute({ requesterId: 'admin1', partnerId: 'ghost' }), /not found/i);

  const flaky = new GetMember360UseCase(deps({
    transactions: {
      find: () => { throw new Error('db down'); },
      countDocuments: async () => { throw new Error('db down'); },
    },
    prospects: {
      countDocuments: async () => { throw new Error('db down'); },
      find: () => { throw new Error('db down'); },
    },
    progress: { levelsFor: async () => { throw new Error('db down'); } },
  }));
  const res = await flaky.execute({ requesterId: 'admin1', partnerId: 'p9' });
  assert.equal(res.identity.email, 'a@x.test');
  assert.equal(res.money.in30d, null);
  assert.equal(res.journey.level, null);
});
