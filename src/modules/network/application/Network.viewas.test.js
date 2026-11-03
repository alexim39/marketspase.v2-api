import test from 'node:test';
import assert from 'node:assert/strict';
import { ResolveViewAsUseCase } from './Network.viewas.js';

const ADMIN = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const UPLINE = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const MEMBER = 'cccccccccccccccccccccccc';
const STRANGER = 'dddddddddddddddddddddddd';

const partners = {
  findById: async (id) => {
    if (String(id) === ADMIN) return { _id: ADMIN, role: 'admin', email: 'a@x.co', username: 'admin' };
    if (String(id) === UPLINE) return { _id: UPLINE, role: 'user', email: 'u@x.co', username: 'upline' };
    if (String(id) === MEMBER) {
      return { _id: MEMBER, role: 'user', email: 'm@x.co', username: 'member', name: 'Mem', surname: 'Ber' };
    }
    return null;
  },
};
// Network stub: UPLINE's downline contains MEMBER only.
const network = {
  findChildren: async (parentIds) => (parentIds.map(String).includes(UPLINE)
    ? [{ id: MEMBER, parentId: UPLINE }]
    : []),
};

const audited = [];
const uc = () => new ResolveViewAsUseCase({
  partners,
  network,
  audits: { record: async (e) => { audited.push(e); return e; } },
});

test('admin may view any member (audited)', async () => {
  const res = await uc().execute({ requesterId: ADMIN, targetId: MEMBER });
  assert.equal(res.relation, 'admin');
  assert.equal(res.member.username, 'member');
  assert.equal(res.member.name, 'Mem Ber');
  assert.equal(audited.at(-1).action, 'account.view-as');
  assert.equal(audited.at(-1).targetId, MEMBER);
});

test('upline may view downline members', async () => {
  const res = await uc().execute({ requesterId: UPLINE, targetId: MEMBER });
  assert.equal(res.relation, 'upline');
});

test('strangers are rejected and viewing self is rejected', async () => {
  await assert.rejects(uc().execute({ requesterId: STRANGER, targetId: MEMBER }), /downline/);
  await assert.rejects(uc().execute({ requesterId: UPLINE, targetId: UPLINE }), /own account/);
});

test('unknown members 404 without confirming existence to strangers', async () => {
  await assert.rejects(
    uc().execute({ requesterId: UPLINE, targetId: 'eeeeeeeeeeeeeeeeeeeeeeee' }),
    /Member not found/,
  );
});
