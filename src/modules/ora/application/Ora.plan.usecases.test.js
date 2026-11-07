import test from 'node:test';
import assert from 'node:assert/strict';
import { GetOraPlanUseCase, SaveOraPlanUseCase } from './Ora.plan.usecases.js';

const fakeStore = () => {
  const rows = new Map();
  return {
    rows,
    async get(partnerId, dateKey) {
      return rows.get(`${partnerId}:${dateKey}`) ?? null;
    },
    async save(partnerId, { dateKey, items, source }) {
      const row = { partnerId, dateKey, items, source, savedAt: new Date() };
      rows.set(`${partnerId}:${dateKey}`, row);
      return row;
    },
  };
};

test('an unsaved day returns an empty shell with its date key', async () => {
  const usecase = new GetOraPlanUseCase({ plans: fakeStore() });
  const plan = await usecase.execute({
    partnerId: 'p1',
    now: new Date('2026-11-07T10:00:00Z'),
  });
  assert.deepEqual(plan.items, []);
  assert.equal(plan.dateKey, '2026-11-07');
  assert.equal(plan.savedAt, null);
});

test('saving twice edits the same day instead of duplicating it', async () => {
  const store = fakeStore();
  const save = new SaveOraPlanUseCase({ plans: store });
  const now = new Date('2026-11-07T10:00:00Z');
  await save.execute({ partnerId: 'p1', now, items: [{ title: 'Follow up with Paul' }] });
  const edited = await save.execute({
    partnerId: 'p1',
    now,
    items: [
      { title: 'Review goal pace', link: '/dashboard/goals' },
      { title: 'Open pipeline', link: '/dashboard/pipeline' },
    ],
  });
  assert.equal(edited.items.length, 2);
  assert.equal(store.rows.size, 1);
  const fetched = await new GetOraPlanUseCase({ plans: store }).execute({ partnerId: 'p1', now });
  assert.deepEqual(fetched.items.map((item) => item.title), ['Review goal pace', 'Open pipeline']);
});

test('an empty plan is rejected', async () => {
  const save = new SaveOraPlanUseCase({ plans: fakeStore() });
  await assert.rejects(save.execute({ partnerId: 'p1', items: [] }), /at least one plan item/i);
});
