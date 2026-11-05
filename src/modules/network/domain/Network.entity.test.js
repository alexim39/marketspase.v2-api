import test from 'node:test';
import assert from 'node:assert/strict';
import { toNetworkNode } from './Network.entity.js';

const id = 'a'.repeat(24);

test('network nodes expose commission rank and earning depth', () => {
  const node = toNetworkNode({
    _id: id,
    username: 'ada',
    name: 'Ada',
    surname: 'T',
    role: 'user',
    commissionRank: 'Ambassador',
    subscription: { plan: 'Pro' },
  });
  assert.equal(node.commissionRank, 'Ambassador');
  assert.equal(node.commissionDepth, 5);
  assert.equal(node.plan, 'Pro');
});

test('network nodes expose the relationship used by the tree', () => {
  const referral = toNetworkNode({ _id: id, username: 'ada', partnerOf: 'parent-1' });
  const placement = toNetworkNode({ _id: id, username: 'ada', placementParentId: 'owner-1' });
  const both = toNetworkNode({ _id: id, username: 'ada', partnerOf: 'parent-1', placementParentId: 'owner-1' });
  assert.equal(referral.relationType, 'referral');
  assert.equal(placement.relationType, 'placement');
  assert.equal(both.relationType, 'referral');
});

test('unknown or missing rank normalizes to Partner', () => {
  const missing = toNetworkNode({ _id: id, username: 'ada' });
  const legacy = toNetworkNode({ _id: id, username: 'ada', commissionRank: 'g8' });
  assert.equal(missing.commissionRank, 'Partner');
  assert.equal(missing.commissionDepth, 1);
  assert.equal(legacy.commissionRank, 'Partner');
  assert.equal(legacy.commissionDepth, 1);
});
