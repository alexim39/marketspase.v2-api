import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GetPoolUseCase, RateLeadUseCase, ImportLeadsUseCase,
  ListAdminLeadsUseCase, DeleteAdminLeadUseCase, ResetAdminLeadUseCase,
} from './Prospect.pool.js';

const survey = (over = {}) => ({
  _id: `s${Math.random().toString(36).slice(2, 8)}`,
  name: 'Ada', surname: 'T', phoneNumber: '08031234567', email: 'a@x.test',
  state: 'Lagos', stateNorm: 'lagos', username: 'business', prospectStatus: 'Not Moved',
  createdAt: new Date(), ratings: [], claimCount: 0,
  importanceOfPassiveIncome: 'Very important', onlineBusinessTimeDedication: '10 hours',
  comfortWithTech: 'Comfortable',
  ...over,
});

const chainable = (rows) => {
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: (n) => ({ lean: async () => rows.slice(0, n).map((r) => ({ ...r })) }),
    lean: async () => rows.map((r) => ({ ...r })),
  };
  return chain;
};

const fakeSurveys = (rows = []) => ({
  rows,
  find: (filter) => chainable(rows.filter((r) => Object.entries(filter ?? {}).every(([k, v]) => {
    if (k === '$or') return true;
    if (v && typeof v === 'object' && '$ne' in v) return r[k] !== v.$ne;
    return String(r[k]) === String(v);
  }))),
  insertMany: async (docs) => {
    const made = docs.map((d, i) => ({ _id: `n${i}`, ...d }));
    rows.push(...made);
    return made;
  },
});

const fakePartners = (state = 'Lagos') => ({
  findById: () => ({ select: () => ({ lean: async () => ({ _id: 'p1', address: { state } }) }) }),
});

const fakeProspects = (mine = []) => ({
  countDocuments: async () => mine.length,
  find: () => ({ select: () => ({ lean: async () => mine.map((r) => ({ ...r })) }) }),
  findOneAndUpdate: (filter, update) => ({
    lean: async () => {
      if (String(filter._id) !== 'c1' || String(filter.partnerId) !== 'p1') return null;
      return { _id: 'c1', ...update.$set };
    },
  }),
});

test('pool enforces state fencing, scores and paginates', async () => {
  const surveys = fakeSurveys([
    survey({ _id: 's1' }),
    survey({ _id: 's2', state: 'Oyo', stateNorm: 'oyo' }),
    survey({ _id: 's3', prospectStatus: 'Moved to Contact' }),
  ]);
  const uc = new GetPoolUseCase({ surveys, prospects: fakeProspects(), partners: fakePartners('Lagos') });
  const res = await uc.execute({ partnerId: 'p1' });
  assert.equal(res.requiresState, false);
  assert.equal(res.total, 1);
  assert.equal(res.items[0].id, 's1');
  assert.ok(res.items[0].badges.includes('Hot'));
  assert.equal(res.partnerState, 'lagos');
  assert.ok(res.meta);
  assert.equal(res.meta.dailyLimit, 100);
});

test('pool blocks members without a state, admins bypass with filter', async () => {
  const surveys = fakeSurveys([survey()]);
  const gated = new GetPoolUseCase({ surveys, prospects: fakeProspects(), partners: fakePartners('') });
  const blocked = await gated.execute({ partnerId: 'p1' });
  assert.equal(blocked.requiresState, true);
  assert.equal(blocked.items.length, 0);

  const admin = new GetPoolUseCase({ surveys, prospects: fakeProspects(), partners: fakePartners('') });
  const open = await admin.execute({ partnerId: 'admin1', isAdmin: true, state: 'Lagos' });
  assert.equal(open.requiresState, false);
  assert.equal(open.total, 1);
});

test('rate validates ownership and range', async () => {
  const uc = new RateLeadUseCase({ prospects: fakeProspects() });
  const ok = await uc.execute({ partnerId: 'p1', prospectId: 'c1', score: 5, note: 'Great' });
  assert.equal(ok.score, 5);
  await assert.rejects(uc.execute({ partnerId: 'p1', prospectId: 'c1', score: 9 }), /1–5/);
  await assert.rejects(uc.execute({ partnerId: 'p2', prospectId: 'c1', score: 4 }), /not found/i);
});

test('import validates rows, normalizes states, caps batches', async () => {
  const surveys = fakeSurveys();
  const uc = new ImportLeadsUseCase({ surveys, maxBatch: 500 });
  const res = await uc.execute({
    rows: [
      { name: 'Ada', surname: 'T', phone: '08031234567', state: 'FCT (Abuja)' },
      { name: '', phone: '123' },
    ],
  });
  assert.equal(res.inserted, 1);
  assert.equal(res.failed.length, 1);
  assert.equal(surveys.rows[0].stateNorm, 'fct abuja');
  assert.equal(surveys.rows[0].username, 'business');
  await assert.rejects(uc.execute({ rows: [] }), /at least one/);
});

test('admin desk lists with filters, summary and rating averages', async () => {
  const rows = [
    survey({ _id: 's1', prospectStatus: 'Not Moved', ratings: [{ score: 5 }, { score: 3 }] }),
    survey({ _id: 's2', state: 'Oyo', stateNorm: 'oyo', prospectStatus: 'Claimed' }),
    survey({ _id: 's3', prospectStatus: 'Moved to Contact' }),
  ];
  const surveys = fakeSurveys(rows);
  surveys.countDocuments = async (filter) => rows.filter((r) => Object.entries(filter ?? {}).every(([k, v]) => {
    if (k === '$or') return true;
    return String(r[k]) === String(v);
  })).length;
  surveys.aggregate = async () => [{ total: 3, notMoved: 1, claimed: 1, moved: 1, new7d: 3 }];
  const uc = new ListAdminLeadsUseCase({ surveys });
  const all = await uc.execute({});
  assert.equal(all.total, 3);
  assert.deepEqual(all.summary, { total: 3, notMoved: 1, claimed: 1, moved: 1, new7d: 3 });
  assert.equal(all.items[0].ratingAvg, 4);
  assert.equal(all.items[0].ratingCount, 2);
  const lagos = await uc.execute({ state: 'Lagos' });
  assert.equal(lagos.total, 2);
  const claimed = await uc.execute({ status: 'Claimed' });
  assert.equal(claimed.total, 1);
  assert.equal(claimed.items[0].id, 's2');
});

test('admin delete removes pool rows only; reset reopens them', async () => {
  const A = '0123456789abcdef01234567';
  const B = '0123456789abcdef01234568';
  const C = '0123456789abcdef01234569';
  const store = new Map([
    [A, survey({ _id: A })],
    [B, survey({ _id: B, username: 'someone' })],
  ]);
  const surveys = {
    findById: (id) => ({ lean: async () => (store.has(String(id)) ? { ...store.get(String(id)) } : null) }),
    deleteOne: async (filter) => { store.delete(String(filter._id)); return { deletedCount: 1 }; },
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        const r = store.get(String(filter._id));
        if (!r || r.username !== 'business') return null;
        Object.assign(r, update.$set ?? {});
        return { ...r };
      },
    }),
  };
  const out = await new DeleteAdminLeadUseCase({ surveys }).execute({ id: A });
  assert.equal(out.id, A);
  assert.equal(store.has(A), false);
  await assert.rejects(new DeleteAdminLeadUseCase({ surveys }).execute({ id: A }), /not found/i);
  await assert.rejects(new DeleteAdminLeadUseCase({ surveys }).execute({ id: B }), /not found/i);
  await assert.rejects(new DeleteAdminLeadUseCase({ surveys }).execute({ id: 'nope' }), /Invalid lead id/);
  const surveys2 = {
    findOneAndUpdate: (filter, update) => ({
      lean: async () => (String(filter._id) === C ? { _id: C, prospectStatus: 'Not Moved' } : null),
    }),
  };
  const reset = await new ResetAdminLeadUseCase({ surveys: surveys2 }).execute({ id: C });
  assert.equal(reset.status, 'Not Moved');
  await assert.rejects(new ResetAdminLeadUseCase({ surveys: surveys2 }).execute({ id: A }), /not found/i);
});
