import test from 'node:test';
import assert from 'node:assert/strict';
import { GetGlobalSearchUseCase } from './Search.usecases.js';

const deps = (over = {}) => ({
  network: {},
  prospects: {
    findByPartnerId: async (pid, { q } = {}) => ({
      items: [{ id: 'pr1', prospectName: 'Adaeze', prospectSurname: '', status: { stage: 'New' } }]
        .filter((p) => !q || `${p.prospectName}`.toLowerCase().includes(String(q).toLowerCase())),
    }),
  },
  community: {
    searchDirectory: async () => [{ username: 'adat', name: 'Ada T' }],
    searchPosts: async () => [{ id: 'po1', title: 'Adaeze wins', kind: 'recognition', body: '' }],
  },
  ...over,
});

test('search fans out across all four groups', async () => {
  const uc = new GetGlobalSearchUseCase(deps());
  const res = await uc.execute({ partnerId: 'p1', q: 'ada' });
  assert.equal(res.q, 'ada');
  assert.equal(res.members.length, 1);
  assert.equal(res.prospects.length, 1);
  assert.equal(res.posts.length, 1);
  assert.ok(Array.isArray(res.courses));
});

test('short queries are rejected', async () => {
  const uc = new GetGlobalSearchUseCase(deps());
  await assert.rejects(uc.execute({ partnerId: 'p1', q: 'a' }), /2 characters/);
});

test('a failing group degrades to empty, never fails search', async () => {
  const uc = new GetGlobalSearchUseCase(deps({
    prospects: { findByPartnerId: async () => { throw new Error('db down'); } },
    community: {
      searchDirectory: async () => { throw new Error('db down'); },
      searchPosts: async () => { throw new Error('db down'); },
    },
  }));
  const res = await uc.execute({ partnerId: 'p1', q: 'ipo' });
  assert.deepEqual(res.members, []);
  assert.deepEqual(res.prospects, []);
  assert.deepEqual(res.posts, []);
  assert.ok(res.courses.length > 0);
});

test('prospects stay scoped to the requester', async () => {
  let seenPid = null;
  const uc = new GetGlobalSearchUseCase(deps({
    prospects: {
      findByPartnerId: async (pid, opts) => {
        seenPid = String(pid);
        return { items: [] };
      },
    },
  }));
  await uc.execute({ partnerId: 'me123', q: 'test' });
  assert.equal(seenPid, 'me123');
});
