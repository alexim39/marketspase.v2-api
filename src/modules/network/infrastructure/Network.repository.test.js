import test from 'node:test';
import assert from 'node:assert/strict';
import { childFilter, project } from './Network.mongo.repository.js';

test('growth chain filters only by campaign placement parent', () => {
  assert.deepEqual(childFilter(['p1'], 'growth'), { placementParentId: { $in: ['p1'] } });
});

test('referral chain filters only by referral parent', () => {
  assert.deepEqual(childFilter(['p1'], 'referral'), { partnerOf: { $in: ['p1'] } });
});

test('all chain keeps referral-first fallback behaviour', () => {
  const filter = childFilter(['p1'], 'all');
  assert.deepEqual(filter.$or, [
    { partnerOf: { $in: ['p1'] } },
    { partnerOf: null, placementParentId: { $in: ['p1'] } },
  ]);
});

test('growth projection uses the placement parent even when a referral parent exists', () => {
  const node = project({
    _id: 'a'.repeat(24),
    username: 'ada',
    partnerOf: 'referral-parent',
    placementParentId: 'placement-owner',
  }, 'growth');
  assert.equal(node.parentId, 'placement-owner');
  assert.equal(node.relationType, 'placement');
});

test('growth projection never falls back to the referral parent', () => {
  const node = project({
    _id: 'a'.repeat(24),
    username: 'ada',
    partnerOf: 'referral-parent',
    placementParentId: null,
  }, 'growth');
  assert.equal(node.parentId, null);
  assert.equal(node.relationType, null);
});

test('referral projection ignores the placement parent', () => {
  const node = project({
    _id: 'a'.repeat(24),
    username: 'ada',
    partnerOf: 'referral-parent',
    placementParentId: 'placement-owner',
  }, 'referral');
  assert.equal(node.parentId, 'referral-parent');
  assert.equal(node.relationType, 'referral');
});
