import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaimPoolLeadUseCase } from './Prospect.claim.js';

const FEE = 250;

const survey = (over = {}) => ({
  _id: 's1',
  name: 'Ada', surname: 'T', email: 'ada@x.test', phoneNumber: '08031234567',
  ageRange: '25-34', socialMedia: ['Instagram'], employedStatus: 'Employed',
  importanceOfPassiveIncome: 'Very important', onlinePurchaseSchedule: 'Monthly',
  primaryOnlineBusinessMotivation: 'Freedom', comfortWithTech: 'Comfortable',
  onlineBusinessTimeDedication: '10 hours', country: 'Nigeria', state: 'Lagos',
  username: 'business', prospectStatus: 'Not Moved',
  ...over,
});

const matches = (doc, filter) => Object.entries(filter ?? {}).every(([k, v]) => {
  if (k === '$or') return v.some((c) => Object.entries(c).every(([fk, fv]) => String(doc[fk]) === String(fv)));
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('$ne' in v) return doc[k] !== v.$ne;
    if ('$gte' in v) return Number(doc[k]) >= Number(v.$gte);
    if ('$gt' in v) return Number(doc[k]) > Number(v.$gt);
    return false;
  }
  return String(doc[k]) === String(v);
});

const fakes = ({ surveys = {}, partners = {}, prospects = [] } = {}) => {
  const surveyRows = new Map(Object.entries(surveys));
  const partnerRows = new Map(Object.entries(partners));
  const prospectRows = [...prospects];
  return {
    surveyRows, partnerRows, prospectRows,
    txs: [],
    surveys: {
      findById: (id) => ({
        lean: async () => {
          const r = surveyRows.get(String(id));
          return r ? { ...r } : null;
        },
      }),
      findOneAndUpdate: (filter, update) => {
        const row = [...surveyRows.values()].find((r) => matches(r, filter));
        if (!row) return { lean: async () => null };
        Object.assign(row, update.$set ?? {});
        return { lean: async () => ({ ...row }) };
      },
      updateOne: async (filter, update) => {
        const row = [...surveyRows.values()].find((r) => matches(r, filter));
        if (row) Object.assign(row, update.$set ?? {});
        return { modifiedCount: row ? 1 : 0 };
      },
      findByIdAndDelete: async (id) => { surveyRows.delete(String(id)); return true; },
    },
    prospects: {
      findOne: (filter) => ({
        lean: async () => {
          const row = prospectRows.find((r) => matches(r, filter));
          return row ? { ...row } : null;
        },
      }),
      countDocuments: async (filter) => prospectRows.filter((r) => matches(r, filter)).length,
      create: async (doc) => {
        if (doc.__failCreate) throw new Error('db down');
        const row = { _id: `c${prospectRows.length + 1}`, ...doc };
        prospectRows.push(row);
        return { ...row };
      },
    },
    partners: {
      findOneAndUpdate: (filter, update) => ({
        lean: async () => {
          const row = [...partnerRows.values()].find((r) => matches(r, filter));
          if (!row) return null;
          if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) row[k] = Number(row[k] ?? 0) + Number(v);
          return { ...row };
        },
      }),
      findByIdAndUpdate: async (id, update) => {
        const r = partnerRows.get(String(id));
        if (!r) return null;
        if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) r[k] = Number(r[k] ?? 0) + Number(v);
        return { ...r };
      },
    },
    transactions: {
      create: async (doc) => {
        const list = Array.isArray(doc) ? doc : [doc];
        const made = list.map((d, i) => ({ _id: `t${i + 1}`, ...d }));
        return Array.isArray(doc) ? made : made[0];
      },
    },
  };
};

// findById must be chainable (.lean()); findOneAndUpdate likewise.
const base = () => {
  const f = fakes({
    surveys: { s1: survey() },
    partners: { p1: { _id: 'p1', balance: 1000 } },
  });
  return f;
};

test('claim debits the fee, creates the prospect and clears the pool row', async () => {
  const f = base();
  const uc = new ClaimPoolLeadUseCase({ ...f, fee: FEE });
  const res = await uc.execute({ partnerId: 'p1', surveyId: 's1', source: 'website' });
  assert.equal(res.fee, FEE);
  assert.equal(res.balance, 750);
  assert.ok(res.prospectId);
  assert.equal(f.partnerRows.get('p1').balance, 750);
  assert.equal(f.prospectRows.length, 1);
  assert.equal(f.prospectRows[0].claimFeePaid, FEE);
  assert.ok(f.prospectRows[0].claimedAt);
  assert.equal(f.surveyRows.has('s1'), false);
});

test('daily claim limit blocks the fourth pickup', async () => {
  const prior = [0, 1, 2].map((i) => ({
    _id: `old${i}`, partnerId: 'p1', prospectPhone: `0800000000${i}`,
    claimedAt: new Date(), claimFeePaid: 250,
  }));
  const f = fakes({
    surveys: { s1: survey() },
    partners: { p1: { _id: 'p1', balance: 10000 } },
    prospects: prior,
  });
  const uc = new ClaimPoolLeadUseCase({ ...f, fee: FEE, dailyLimit: 3 });
  await assert.rejects(
    uc.execute({ partnerId: 'p1', surveyId: 's1' }),
    /Daily claim limit reached/,
  );
  assert.equal(f.partnerRows.get('p1').balance, 10000);
  assert.equal(f.surveyRows.get('s1').prospectStatus, 'Not Moved');
});

test('claim refuses overdrafts, taken leads, dupes and foreign pools', async () => {
  const broke = base();
  broke.partnerRows.get('p1').balance = 100;
  await assert.rejects(
    new ClaimPoolLeadUseCase({ ...broke, fee: FEE }).execute({ partnerId: 'p1', surveyId: 's1' }),
    /Insufficient wallet balance/,
  );
  // Balance untouched, pool row released back.
  assert.equal(broke.partnerRows.get('p1').balance, 100);
  assert.equal(broke.surveyRows.get('s1').prospectStatus, 'Not Moved');

  const taken = base();
  taken.surveyRows.get('s1').prospectStatus = 'Moved to Contact';
  await assert.rejects(
    new ClaimPoolLeadUseCase({ ...taken, fee: FEE }).execute({ partnerId: 'p1', surveyId: 's1' }),
    /just claimed/,
  );

  const dupe = base();
  dupe.prospectRows.push({ _id: 'c0', partnerId: 'p1', prospectPhone: '08031234567' });
  await assert.rejects(
    new ClaimPoolLeadUseCase({ ...dupe, fee: FEE }).execute({ partnerId: 'p1', surveyId: 's1' }),
    /already in your contacts/,
  );

  const missing = base();
  await assert.rejects(
    new ClaimPoolLeadUseCase({ ...missing, fee: FEE }).execute({ partnerId: 'p1', surveyId: '0123456789abcdef01234567' }),
    /no longer in the pool/,
  );
});
