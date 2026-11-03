import test from 'node:test';
import assert from 'node:assert/strict';
import { PinPostUseCase } from './Community.usecases.js';

const post = (over = {}) => ({
  _id: 'post1',
  authorId: 'author1',
  kind: 'announcement',
  scope: 'global',
  pinned: false,
  pinnedUntil: null,
  ...over,
});

const fakes = ({ posts = {}, role = 'user', pinnedCount = 0 } = {}) => {
  const rows = new Map(Object.entries(posts));
  return {
    community: {
      findPostById: async (id) => {
        const r = rows.get(String(id));
        return r ? { ...r } : null;
      },
      setPinned: async (id, pinned, until = null) => {
        const r = rows.get(String(id));
        const next = { ...r, pinned, pinnedUntil: pinned ? until : null };
        rows.set(String(id), next);
        return { ...next };
      },
      countPinned: async () => pinnedCount,
    },
    partners: {
      findById: async (id) => (String(id) === 'admin1' || role === 'admin'
        ? { role: 'admin' }
        : { role: 'user' }),
    },
  };
};

test('author can pin announcements and events, others cannot', async () => {
  const f = fakes({ posts: { post1: post() } });
  const uc = new PinPostUseCase(f);
  const out = await uc.execute({ partnerId: 'author1', postId: 'post1', pinned: true });
  assert.equal(out.pinned, true);
  await assert.rejects(
    new PinPostUseCase(f).execute({ partnerId: 'stranger', postId: 'post1', pinned: true }),
    /author or an admin/,
  );
});

test('standard posts can never pin; admin overrides authorship but not kind', async () => {
  const f = fakes({ posts: { post1: post({ kind: 'standard' }) }, role: 'admin' });
  const uc = new PinPostUseCase(f);
  await assert.rejects(uc.execute({ partnerId: 'admin1', postId: 'post1', pinned: true }), /announcements and events/);
  const g = fakes({ posts: { post1: post({ kind: 'event' }) }, role: 'admin' });
  const out = await new PinPostUseCase(g).execute({ partnerId: 'admin1', postId: 'post1', pinned: true });
  assert.equal(out.pinned, true);
});

test('cap blocks the 4th pin; unpin always allowed', async () => {
  const f = fakes({ posts: { post1: post() }, pinnedCount: 3 });
  await assert.rejects(
    new PinPostUseCase(f).execute({ partnerId: 'author1', postId: 'post1', pinned: true }),
    /Pin limit reached/,
  );
  const pinned = fakes({ posts: { post1: post({ pinned: true }) }, pinnedCount: 3 });
  const out = await new PinPostUseCase(pinned).execute({ partnerId: 'author1', postId: 'post1', pinned: false });
  assert.equal(out.pinned, false);
});

test('expiry must be future-dated when given', async () => {
  const f = fakes({ posts: { post1: post() } });
  await assert.rejects(
    new PinPostUseCase(f).execute({ partnerId: 'author1', postId: 'post1', pinned: true, pinnedUntil: new Date(Date.now() - 1000) }),
    /future/,
  );
  const out = await new PinPostUseCase(f).execute({
    partnerId: 'author1', postId: 'post1', pinned: true, pinnedUntil: new Date(Date.now() + 86400000),
  });
  assert.ok(out.pinnedUntil);
});
