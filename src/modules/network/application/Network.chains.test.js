import test from 'node:test';
import assert from 'node:assert/strict';
import { GetDownlineTreeUseCase, GetUplineChainUseCase } from './Network.queries.js';

const root = {
  id: 'root',
  username: 'root',
  name: 'Root',
  surname: '',
  role: 'user',
  commissionRank: 'Leader',
  commissionDepth: 3,
  relationType: null,
  parentId: null,
};
const referralChild = {
  id: 'ref-1',
  username: 'ref',
  name: 'Referral',
  surname: '',
  role: 'user',
  commissionRank: 'Partner',
  commissionDepth: 1,
  relationType: 'referral',
  parentId: 'root',
};
const placementChild = {
  id: 'place-1',
  username: 'place',
  name: 'Placement',
  surname: '',
  role: 'user',
  commissionRank: 'Builder',
  commissionDepth: 2,
  relationType: 'placement',
  parentId: 'root',
};

test('tree follows the requested chain and reports it in meta', async () => {
  const calls = [];
  const network = {
    findNode: async (id, chain) => {
      calls.push({ id, chain });
      return id === 'root' ? { ...root } : null;
    },
    findChildren: async (ids, limit, chain) => {
      calls.push({ ids, limit, chain });
      return chain === 'growth' ? [{ ...placementChild }] : [{ ...referralChild }];
    },
  };
  const growth = await new GetDownlineTreeUseCase({ network }).execute({
    partnerId: 'root', depth: 2, chain: 'growth',
  });
  assert.equal(growth.meta.chain, 'growth');
  assert.equal(growth.tree.children[0].relationType, 'placement');
  assert.ok(calls.every((call) => call.chain === 'growth' || call.chain === undefined));

  const referral = await new GetDownlineTreeUseCase({ network }).execute({
    partnerId: 'root', depth: 2, chain: 'referral',
  });
  assert.equal(referral.meta.chain, 'referral');
  assert.equal(referral.tree.children[0].relationType, 'referral');
  assert.equal(growth.systemRoot?.name, 'MarketSpase');
  assert.equal(growth.systemRoot?.earning, false);
});

test('upline walks the requested chain parent links', async () => {
  const growthParent = {
    ...root,
    id: 'owner',
    username: 'owner',
    placementParentId: 'grand-owner',
    parentId: 'grand-owner',
    relationType: 'placement',
  };
  const grandParent = {
    ...root,
    id: 'grand-owner',
    username: 'grand',
    placementParentId: null,
    parentId: null,
    relationType: 'placement',
  };
  const network = {
    findNode: async (id, chain) => {
      assert.equal(chain, 'growth');
      if (id === 'root') return { ...root, placementParentId: 'owner', parentId: 'owner', relationType: 'placement' };
      if (id === 'owner') return growthParent;
      if (id === 'grand-owner') return grandParent;
      return null;
    },
  };
  const result = await new GetUplineChainUseCase({ network }).execute({ partnerId: 'root', chain: 'growth' });
  assert.equal(result.chainMode, 'growth');
  assert.deepEqual(result.chain.map((n) => n.id), ['owner', 'grand-owner']);
  assert.equal(result.systemRoot?.id, 'system-root');
  assert.equal(result.systemRoot?.earning, false);
});
