import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ListSubscriptionsUseCase, SetSubscriptionStatusUseCase,
  DeleteSubscriptionUseCase, ExportSubscriptionsUseCase,
} from './Subscription.usecases.js';

const row = (over = {}) => ({
  _id: '0123456789abcdef01234567',
  email: 'a@x.test',
  status: 'Subscribed',
  userDevice: 'desktop',
  username: 'business',
  createdAt: new Date(),
  ...over,
});

const fakeSubs = (rows = []) => {
  const store = [...rows];
  const chainable = (list) => {
    const chain = {
      sort: () => chain,
      skip: (n) => ({ limit: (l) => ({ lean: async () => list.slice(n, n + l).map((r) => ({ ...r })) }) }),
      limit: (l) => ({ lean: async () => list.slice(0, l).map((r) => ({ ...r })) }),
    };
    return chain;
  };
  return {
    store,
    find: (filter) => chainable(store.filter((r) => Object.entries(filter ?? {}).every(([k, v]) => {
      if (k === '$or') return v.some((c) => Object.entries(c).some(([fk, rx]) => rx.test(String(r[fk] ?? ''))));
      return String(r[k]) === String(v);
    }))),
    countDocuments: async (filter) => store.filter((r) => Object.entries(filter ?? {}).every(([k, v]) => {
      if (k === '$or') return v.some((c) => Object.entries(c).some(([fk, rx]) => rx.test(String(r[fk] ?? ''))));
      return String(r[k]) === String(v);
    })).length,
    aggregate: async () => [{ total: store.length, subscribed: 1, unsubscribed: 1, new7d: 2 }],
    findByIdAndUpdate: (id, update) => ({
      lean: async () => {
        const r = store.find((x) => String(x._id) === String(id));
        if (!r) return null;
        Object.assign(r, update.$set ?? {});
        return { ...r };
      },
    }),
    findById: (id) => ({ lean: async () => {
      const r = store.find((x) => String(x._id) === String(id));
      return r ? { ...r } : null;
    } }),
    deleteOne: async (filter) => {
      const i = store.findIndex((x) => String(x._id) === String(filter._id));
      if (i >= 0) store.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
  };
};

test('desk lists with filters and summary', async () => {
  const subs = fakeSubs([
    row({}),
    row({ _id: '0123456789abcdef01234568', email: 'b@x.test', status: 'Unsubscribed' }),
  ]);
  const uc = new ListSubscriptionsUseCase({ subscriptions: subs });
  const all = await uc.execute({});
  assert.equal(all.total, 2);
  assert.deepEqual(all.summary, { total: 2, subscribed: 1, unsubscribed: 1, new7d: 2 });
  const q = await uc.execute({ q: 'b@x' });
  assert.equal(q.total, 1);
  const f = await uc.execute({ status: 'Unsubscribed' });
  assert.equal(f.total, 1);
});

test('status flips and validates; delete removes and guards', async () => {
  const subs = fakeSubs([row({})]);
  const flipped = await new SetSubscriptionStatusUseCase({ subscriptions: subs }).execute({
    id: '0123456789abcdef01234567', status: 'Unsubscribed',
  });
  assert.equal(flipped.status, 'Unsubscribed');
  await assert.rejects(
    new SetSubscriptionStatusUseCase({ subscriptions: subs }).execute({ id: '0123456789abcdef01234567', status: 'Maybe' }),
    /Subscribed or Unsubscribed/,
  );
  const out = await new DeleteSubscriptionUseCase({ subscriptions: subs }).execute({ id: '0123456789abcdef01234567' });
  assert.equal(out.email, 'a@x.test');
  assert.equal(subs.store.length, 0);
  await assert.rejects(new DeleteSubscriptionUseCase({ subscriptions: subs }).execute({ id: '0123456789abcdef01234567' }), /not found/i);
  await assert.rejects(new DeleteSubscriptionUseCase({ subscriptions: subs }).execute({ id: 'nope' }), /Invalid subscription id/);
});

test('export caps and mirrors filters', async () => {
  const subs = fakeSubs([row({}), row({ _id: '0123456789abcdef01234568', email: 'b@x.test' })]);
  const res = await new ExportSubscriptionsUseCase({ subscriptions: subs, max: 1 }).execute({});
  assert.equal(res.items.length, 1);
  assert.equal(res.capped, true);
});
