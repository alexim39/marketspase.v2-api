import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProspectAccess, isUplineOf } from './Prospect.access.js';

const partners = {
  owner: { _id: 'owner', role: 'user', partnerOf: null, placementParentId: 'mentor' },
  mentor: { _id: 'mentor', role: 'user', partnerOf: null, placementParentId: null },
  referred: { _id: 'referred', role: 'user', partnerOf: 'refParent', placementParentId: 'mentor' },
  refParent: { _id: 'refParent', role: 'user', partnerOf: null, placementParentId: null },
  outsider: { _id: 'outsider', role: 'user', partnerOf: null, placementParentId: null },
  admin: { _id: 'admin', role: 'admin', partnerOf: null, placementParentId: null },
};

const findPartnerById = async (id) => partners[String(id)] ?? null;
const guard = buildProspectAccess({
  findProspectById: async () => null,
  findPartnerById,
});

test('a referral upline still has list access', async () => {
  assert.equal(await isUplineOf(findPartnerById, 'refParent', 'referred'), true);
  const access = await guard.requireListAccess('refParent', 'referred');
  assert.equal(access.relation, 'upline');
});

test('a campaign placement mentor is treated as the effective upline', async () => {
  assert.equal(await isUplineOf(findPartnerById, 'mentor', 'owner'), true);
  const access = await guard.requireListAccess('mentor', 'owner');
  assert.equal(access.relation, 'upline');
});

test('a referral parent wins over a different campaign placement parent', async () => {
  assert.equal(await isUplineOf(findPartnerById, 'mentor', 'referred'), false);
  assert.equal(await isUplineOf(findPartnerById, 'refParent', 'referred'), true);
});

test('admins and owners keep access; outsiders do not', async () => {
  assert.equal((await guard.requireListAccess('admin', 'owner')).relation, 'admin');
  assert.equal((await guard.requireListAccess('owner', 'owner')).relation, 'owner');
  await assert.rejects(() => guard.requireListAccess('outsider', 'owner'), /not found/i);
});

test('a cycle in the parent chain does not hang or grant access', async () => {
  const cyclic = {
    a: { _id: 'a', partnerOf: 'b', placementParentId: null },
    b: { _id: 'b', partnerOf: 'a', placementParentId: null },
  };
  const find = async (id) => cyclic[String(id)] ?? null;
  assert.equal(await isUplineOf(find, 'x', 'a'), false);
});
