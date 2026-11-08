import test from 'node:test';
import assert from 'node:assert/strict';
import { childFilter, project } from './Network.mongo.repository.js';

test('every chain mode traverses the single partnerOf upline', () => {
  for (const chain of ['growth', 'referral', 'all']) {
    assert.deepEqual(childFilter(['p1'], chain), { partnerOf: { $in: ['p1'] } });
  }
});

test('projection uses partnerOf as the only parent', () => {
  const node = project({
    _id: 'a'.repeat(24),
    username: 'ada',
    partnerOf: 'upline-1',
    placementCampaignId: 'campaign-1',
  }, 'growth');
  assert.equal(node.parentId, 'upline-1');
  assert.equal(node.relationType, 'placement');
});

test('a referral member is projected through the same partnerOf edge', () => {
  const node = project({
    _id: 'a'.repeat(24),
    username: 'ada',
    partnerOf: 'sponsor-1',
  }, 'referral');
  assert.equal(node.parentId, 'sponsor-1');
  assert.equal(node.relationType, 'referral');
});

test('a member with no partnerOf is a system-owned root candidate', () => {
  const node = project({
    _id: 'a'.repeat(24),
    username: 'ada',
    partnerOf: null,
  }, 'all');
  assert.equal(node.parentId, null);
  assert.equal(node.relationType, null);
});
