import test from 'node:test';
import assert from 'node:assert/strict';
import { PushPoolLeadToPartnerUseCase } from './Prospect.push.js';
import { AssignPoolLeadToPartnerUseCase } from './Prospect.push.js';

const survey = (over = {}) => ({
  _id: '64f000000000000000000001',
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
      create: async (doc) => {
        if (doc.__failCreate) throw new Error('db down');
        const row = { _id: `c${prospectRows.length + 1}`, ...doc };
        prospectRows.push(row);
        return { ...row };
      },
    },
    partners: {
      findOne: () => ({
        select: () => ({
          lean: async () => ({ _id: 'p1', username: 'market' }),
        }),
      }),
    },
  };
};

const LEAD_ID = '64f000000000000000000001';

const base = () => fakes({ surveys: { [LEAD_ID]: survey() } });

test('push creates a free pipeline copy and clears the pool row', async () => {
  const f = base();
  const uc = new PushPoolLeadToPartnerUseCase({ ...f });
  const res = await uc.execute({ leadId: LEAD_ID, username: 'market' });
  assert.ok(res.prospectId);
  assert.equal(res.username, 'market');
  assert.equal(f.prospectRows.length, 1);
  assert.equal(f.prospectRows[0].claimFeePaid, 0);
  assert.equal(f.prospectRows[0].prospectSource, 'Admin Push');
  assert.ok(f.prospectRows[0].claimedAt);
  assert.equal(String(f.prospectRows[0].partnerId), 'p1');
  assert.equal(f.surveyRows.has(LEAD_ID), false);
});

test('push rejects unknown usernames and business', async () => {
  const f = base();
  f.partners.findOne = () => ({ select: () => ({ lean: async () => null }) });
  const uc = new PushPoolLeadToPartnerUseCase({ ...f });
  await assert.rejects(uc.execute({ leadId: LEAD_ID, username: 'ghost' }), /Target partner not found/);
  await assert.rejects(uc.execute({ leadId: LEAD_ID, username: 'business' }), /Cannot push to business/);
  await assert.rejects(uc.execute({ leadId: 'nope', username: 'market' }), /Invalid lead id/);
});

test('push refuses rows already taken and duplicates in target contacts', async () => {
  const taken = base();
  taken.surveyRows.get(LEAD_ID).prospectStatus = 'Moved to Contact';
  await assert.rejects(
    new PushPoolLeadToPartnerUseCase({ ...taken }).execute({ leadId: LEAD_ID, username: 'market' }),
    /just claimed by someone else/,
  );
  const dupe = base();
  dupe.prospectRows.push({ _id: 'c0', partnerId: 'p1', prospectPhone: '08031234567' });
  await assert.rejects(
    new PushPoolLeadToPartnerUseCase({ ...dupe }).execute({ leadId: LEAD_ID, username: 'market' }),
    /already in their contacts/,
  );
});

test('push releases the pool row when the pipeline create fails', async () => {
  const f = base();
  const failing = {
    ...f,
    prospects: {
      ...f.prospects,
      create: async () => { throw new Error('db down'); },
    },
  };
  await assert.rejects(
    new PushPoolLeadToPartnerUseCase({ ...failing }).execute({ leadId: LEAD_ID, username: 'market' }),
    /db down/,
  );
  assert.equal(f.surveyRows.get(LEAD_ID).prospectStatus, 'Not Moved');
});

test('assign transfers row ownership to the partner inbox, no pipeline copy', async () => {
  const f = base();
  const uc = new AssignPoolLeadToPartnerUseCase({ ...f });
  const res = await uc.execute({ leadId: LEAD_ID, username: 'market' });
  assert.equal(res.id, LEAD_ID);
  assert.equal(res.username, 'market');
  assert.equal(f.surveyRows.get(LEAD_ID).username, 'market');
  assert.equal(f.prospectRows.length, 0);
});

test('assign rejects bad targets and rows no longer up for grabs', async () => {
  const f = base();
  f.partners.findOne = () => ({ select: () => ({ lean: async () => null }) });
  const uc = new AssignPoolLeadToPartnerUseCase({ ...f });
  await assert.rejects(uc.execute({ leadId: LEAD_ID, username: 'ghost' }), /Target partner not found/);
  await assert.rejects(uc.execute({ leadId: LEAD_ID, username: 'business' }), /Cannot assign to business/);
  await assert.rejects(uc.execute({ leadId: 'nope', username: 'market' }), /Invalid lead id/);

  const taken = base();
  taken.surveyRows.get(LEAD_ID).prospectStatus = 'Claimed';
  await assert.rejects(
    new AssignPoolLeadToPartnerUseCase({ ...taken }).execute({ leadId: LEAD_ID, username: 'market' }),
    /no longer available in the pool/,
  );
  const owned = base();
  owned.surveyRows.get(LEAD_ID).username = 'market';
  await assert.rejects(
    new AssignPoolLeadToPartnerUseCase({ ...owned }).execute({ leadId: LEAD_ID, username: 'other' }),
    /no longer available in the pool/,
  );
});
