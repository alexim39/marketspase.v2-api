import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SendBroadcastUseCase, ListBroadcastsUseCase } from './Broadcast.usecases.js';
import { BROADCAST_CAP, createBroadcastInput } from '../domain/Broadcast.js';

const fakeBroadcasts = () => {
  const rows = [];
  return {
    rows,
    create: async (doc) => {
      const row = { _id: `b${rows.length + 1}`, ...doc };
      rows.push(row);
      return row;
    },
    updateOne: async (filter, update) => {
      const row = rows.find((r) => String(r._id) === String(filter._id));
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: row ? 1 : 0 };
    },
    find: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => rows }) }) }) }),
    countDocuments: async () => rows.length,
  };
};

const fakePartners = (n) => ({
  find: () => ({
    select: () => ({
      sort: () => ({
        limit: () => ({
          lean: async () => Array.from({ length: n }, (_, i) => ({ _id: `p${i}` })),
        }),
      }),
    }),
  }),
});

const fakeNotify = (failOn = new Set()) => {
  const calls = [];
  return {
    calls,
    execute: async (input) => {
      calls.push(input);
      if (failOn.has(input.recipientId)) throw new Error('channel down');
      return { id: `n${calls.length}` };
    },
  };
};

describe('createBroadcastInput', () => {
  it('accepts title/body/link/priority', () => {
    const out = createBroadcastInput({ title: 'Hello all', body: 'Maintenance tonight', link: '/dashboard', priority: 'medium' });
    assert.equal(out.priority, 'medium');
  });

  it('defaults link to null and priority to high', () => {
    const out = createBroadcastInput({ title: 'Hello all', body: 'Maintenance tonight' });
    assert.equal(out.link, null);
    assert.equal(out.priority, 'high');
  });

  it('rejects short/blank content', () => {
    assert.throws(() => createBroadcastInput({ title: 'Hi', body: 'ok fine content here' }), /Invalid title/);
    assert.throws(() => createBroadcastInput({ title: 'Hello all', body: '' }), /Invalid body/);
  });
});

describe('SendBroadcastUseCase', () => {
  it('fans out one keyed row per partner', async () => {
    const notify = fakeNotify();
    const broadcasts = fakeBroadcasts();
    const uc = new SendBroadcastUseCase({ partners: fakePartners(3), broadcasts, notify });
    const res = await uc.execute({ createdBy: 'admin1', title: 'Hello all', body: 'Maintenance tonight' });
    assert.equal(res.delivered, 3);
    assert.equal(res.failed, 0);
    assert.equal(res.capped, false);
    assert.ok(notify.calls.every((c) => c.key.startsWith('broadcast:') && c.category === 'system'));
    assert.equal(broadcasts.rows[0].recipientCount, 3);
  });

  it('counts failures without failing the send', async () => {
    const notify = fakeNotify(new Set(['p1']));
    const uc = new SendBroadcastUseCase({ partners: fakePartners(3), broadcasts: fakeBroadcasts(), notify });
    const res = await uc.execute({ createdBy: 'admin1', title: 'Hello all', body: 'Maintenance tonight' });
    assert.equal(res.delivered, 2);
    assert.equal(res.failed, 1);
  });

  it('caps the recipient burst and flags it', async () => {
    const notify = fakeNotify();
    const uc = new SendBroadcastUseCase({ partners: fakePartners(BROADCAST_CAP + 5), broadcasts: fakeBroadcasts(), notify });
    const res = await uc.execute({ createdBy: 'admin1', title: 'Hello all', body: 'Maintenance tonight' });
    assert.equal(res.total, BROADCAST_CAP);
    assert.equal(res.capped, true);
    assert.equal(notify.calls.length, BROADCAST_CAP);
  });
});

describe('ListBroadcastsUseCase', () => {
  it('returns history newest-first shape', async () => {
    const broadcasts = fakeBroadcasts();
    await broadcasts.create({ title: 'T', body: 'B', link: null, priority: 'high', createdBy: 'a' });
    const uc = new ListBroadcastsUseCase({ broadcasts });
    const res = await uc.execute({});
    assert.equal(res.total, 1);
    assert.equal(res.items[0].title, 'T');
  });
});
