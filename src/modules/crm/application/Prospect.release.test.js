import test from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseProspectToPoolUseCase, RELEASE_WINDOW_DAYS } from './Prospect.release.js';

const prospect = (over = {}) => ({
  _id: 'c1',
  partnerId: 'p1',
  prospectName: 'Ada',
  prospectSurname: 'T',
  prospectEmail: 'ada@x.test',
  prospectPhone: '08031234567',
  surverId: 's9',
  claimedAt: new Date(),
  survey: {
    ageRange: '25-34', socialMedia: ['Instagram'], employedStatus: 'Employed',
    importanceOfPassiveIncome: 'Very important', onlinePurchaseSchedule: 'Monthly',
    primaryOnlineBusinessMotivation: 'Freedom', comfortWithTech: 'Comfortable',
    onlineBusinessTimeDedication: '10 hours', state: 'Lagos', country: 'Nigeria',
  },
  ...over,
});

const fakes = (rows = {}) => {
  const byId = new Map(Object.entries(rows));
  const created = [];
  const txs = [];
  return {
    created,
    txs,
    prospects: {
      findById: async (id) => {
        const r = byId.get(String(id));
        return r ? { ...r } : null;
      },
      deleteById: async (id) => { byId.delete(String(id)); return true; },
    },
    surveys: {
      create: async (doc) => {
        const row = { _id: `n${created.length + 1}`, ...doc };
        created.push(row);
        return { ...row };
      },
    },
    partners: {
      findByIdAndUpdate: async (id, update) => {
        const key = `bal:${String(id)}`;
        const cur = byId.get(key) ?? 1000;
        const next = cur + Number(update.$inc?.balance ?? 0);
        byId.set(key, next);
        return { balance: next };
      },
    },
    transactions: {
      create: async (doc) => {
        const list = Array.isArray(doc) ? doc : [doc];
        const made = list.map((d, i) => ({ _id: `t${txs.length + i + 1}`, ...d }));
        made.forEach((m) => txs.push(m));
        return made;
      },
    },
  };
};

test('releases a pool lead inside the window and restores the pool row', async () => {
  const f = fakes({ c1: prospect({ claimFeePaid: 250 }) });
  const uc = new ReleaseProspectToPoolUseCase(f);
  const res = await uc.execute({ partnerId: 'p1', prospectId: 'c1' });
  assert.equal(res.released, true);
  assert.ok(res.surveyId);
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].username, 'business');
  assert.equal(f.created[0].prospectStatus, 'Not Moved');
  assert.equal(f.created[0].phoneNumber, '08031234567');
  assert.equal(f.created[0].state, 'Lagos');
  assert.equal(f.created[0].stateNorm, 'lagos');
  // Paid claim → ₦120 refund + credit record.
  assert.equal(res.refunded, 120);
  assert.equal(f.txs.length, 1);
  assert.equal(f.txs[0].paymentMethod, 'Lead Return Refund');
  assert.equal(f.txs[0].amount, 120);
});

test('pre-fee claims restore the pool with no money movement', async () => {
  const f = fakes({ c1: prospect({ claimFeePaid: null }) });
  const uc = new ReleaseProspectToPoolUseCase(f);
  const res = await uc.execute({ partnerId: 'p1', prospectId: 'c1' });
  assert.equal(res.released, true);
  assert.equal(res.refunded, 0);
  assert.equal(f.txs.length, 0);
});

test('rejects foreign rows, personal contacts and stale claims', async () => {
  const old = new Date(Date.now() - (RELEASE_WINDOW_DAYS + 1) * 86400000);
  const f = fakes({
    mine: prospect({ _id: 'mine' }),
    theirs: prospect({ _id: 'theirs', partnerId: 'p2' }),
    personal: prospect({ _id: 'personal', surverId: null, survey: null }),
    stale: prospect({ _id: 'stale', claimedAt: old }),
    untracked: prospect({ _id: 'untracked', claimedAt: null }),
    converted: prospect({ _id: 'converted', status: { stage: 'Converted' } }),
  });
  const uc = new ReleaseProspectToPoolUseCase(f);
  await assert.rejects(uc.execute({ partnerId: 'p1', prospectId: 'ghost' }), /not found/i);
  await assert.rejects(uc.execute({ partnerId: 'p1', prospectId: 'theirs' }), /your own/i);
  await assert.rejects(uc.execute({ partnerId: 'p1', prospectId: 'personal' }), /Buy Prospect/i);
  await assert.rejects(uc.execute({ partnerId: 'p1', prospectId: 'stale' }), /window closed/i);
  await assert.rejects(uc.execute({ partnerId: 'p1', prospectId: 'converted' }), /permanently/i);
  // Pre-tracking claims keep the grace path.
  const res = await uc.execute({ partnerId: 'p1', prospectId: 'untracked' });
  assert.equal(res.released, true);
});
