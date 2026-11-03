import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ListReportedUseCase, ModeratePostUseCase } from './Community.moderation.usecase.js';

const fakeCommunity = (posts = []) => {
  const byId = new Map(posts.map((p) => [p.id, { ...p }]));
  return {
    byId,
    queue: null,
    findPostById: async (id) => byId.has(String(id)) ? { ...byId.get(String(id)) } : null,
    reportedQueue: async (q) => ({ items: [...byId.values()], total: byId.size, limit: 25, skip: 0, echo: q }),
    deletePostCascade: async (id) => { byId.delete(String(id)); return { deleted: true }; },
    dismissReports: async () => ({ dismissed: 2 }),
  };
};

describe('ListReportedUseCase', () => {
  it('returns the store queue untouched', async () => {
    const community = fakeCommunity([{ id: 'p1' }]);
    const uc = new ListReportedUseCase({ community });
    const res = await uc.execute({ limit: 10, skip: 0 });
    assert.equal(res.total, 1);
  });
});

describe('ModeratePostUseCase', () => {
  it('removes reported posts via cascade', async () => {
    const community = fakeCommunity([{ id: 'p1' }]);
    const uc = new ModeratePostUseCase({ community });
    const res = await uc.execute({ postId: 'p1', decision: 'remove' });
    assert.deepEqual(res, { decision: 'remove', postId: 'p1' });
    assert.equal(community.byId.has('p1'), false);
  });

  it('dismisses reports while keeping the post', async () => {
    const community = fakeCommunity([{ id: 'p1' }]);
    const uc = new ModeratePostUseCase({ community });
    const res = await uc.execute({ postId: 'p1', decision: 'dismiss' });
    assert.deepEqual(res, { decision: 'dismiss', postId: 'p1', dismissed: 2 });
    assert.equal(community.byId.has('p1'), true);
  });

  it('404s missing posts and rejects bad decisions', async () => {
    const uc = new ModeratePostUseCase({ community: fakeCommunity([]) });
    await assert.rejects(uc.execute({ postId: 'ghost', decision: 'remove' }), /not found/i);
    await assert.rejects(uc.execute({ postId: 'p1', decision: 'ban' }), /Unknown decision/);
  });
});
