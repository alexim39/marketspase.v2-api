import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErasePartnerUseCase } from './Admin.usecase.js';

const partner = (over = {}) => ({
  _id: 'p1', username: 'someone', name: 'Some', surname: 'One',
  email: 'someone@x.test', phone: '08000000001', role: 'user', password: 'hashed',
  ...over,
});

const fakePartners = (rows = []) => {
  const byId = new Map(rows.map((r) => [String(r._id), { ...r }]));
  return {
    byId,
    downline: 0,
    reassignCalls: [],
    findById: async (id) => byId.has(String(id)) ? { ...byId.get(String(id)) } : null,
    updateById: async (id, patch) => {
      const row = byId.get(String(id));
      if (!row) return null;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete row[k];
        else row[k] = v;
      }
      return { ...row };
    },
    countByRole: async (role) => [...byId.values()].filter((r) => String(r.role).toLowerCase() === role).length,
    countDownline: async () => fakePartners.downlineCount ?? 0,
    reassignDownline: async function (id, next) {
      this.reassignCalls.push([String(id), String(next)]);
      let n = 0;
      for (const r of byId.values()) {
        if (String(r.partnerOf ?? '') === String(id)) { r.partnerOf = String(next); n++; }
      }
      return n;
    },
  };
};
fakePartners.downlineCount = 0;

const counter = (n) => ({ deleteByPartner: async () => n });
const fakeSessions = () => {
  const calls = [];
  return {
    calls,
    revoke: async (id, opts) => { calls.push(['revoke', id, opts]); },
    clear: async (id) => { calls.push(['clear', id]); },
  };
};

const eraseUc = (rows, extra = {}) => new ErasePartnerUseCase({
  partners: fakePartners(rows),
  prospects: counter(3),
  tickets: counter(1),
  codes: counter(2),
  sessions: fakeSessions(),
  ...extra,
});

describe('ErasePartnerUseCase', () => {
  it('anonymizes PII, clears secrets, locks and revokes', async () => {
    const sessions = fakeSessions();
    const uc = new ErasePartnerUseCase({
      partners: fakePartners([partner()]),
      prospects: counter(3), tickets: counter(1), codes: counter(2), sessions,
    });
    const res = await uc.execute({ requesterId: 'admin1', partnerId: 'p1' });
    assert.deepEqual(res.removed, { prospects: 3, tickets: 1, codes: 2 });
    const e = res.erased;
    assert.equal(e.name, 'Deleted');
    assert.match(e.email, /^deleted_[a-z0-9]+@deleted\.local$/);
    assert.match(e.username, /^deleted_[a-z0-9]+$/);
    assert.notEqual(e.password, 'hashed');
    assert.equal(e.suspended, true);
    assert.equal(e.resetPasswordToken, undefined);
    assert.deepEqual(sessions.calls[0][0], 'revoke');
    assert.equal(sessions.calls[0][1], 'p1');
  });

  it('refuses self, last admin, unknown and downline owners', async () => {
    const uc = eraseUc([partner({ _id: 'me' })]);
    await assert.rejects(uc.execute({ requesterId: 'me', partnerId: 'me' }), /own account/);

    const admins = eraseUc([partner({ _id: 'a1', role: 'admin' })]);
    await assert.rejects(admins.execute({ requesterId: 'root', partnerId: 'a1' }), /last admin/);

    await assert.rejects(uc.execute({ requesterId: 'admin1', partnerId: 'ghost' }), /not found/i);

    fakePartners.downlineCount = 4;
    try {
      const busy = eraseUc([partner({ _id: 'upline' })]);
      await assert.rejects(busy.execute({ requesterId: 'admin1', partnerId: 'upline' }), /Reassign 4 downline/);
    } finally {
      fakePartners.downlineCount = 0;
    }
  });

  it('tolerates missing optional stores', async () => {
    const uc = new ErasePartnerUseCase({ partners: fakePartners([partner()]) });
    const res = await uc.execute({ requesterId: 'admin1', partnerId: 'p1' });
    assert.deepEqual(res.removed, { prospects: 0, tickets: 0, codes: 0 });
    assert.equal(res.erased.suspended, true);
  });

  it('moves mid-tree downline one level up instead of refusing', async () => {
    fakePartners.downlineCount = 2;
    try {
      const store = fakePartners([
        partner({ _id: 'mid', partnerOf: 'grand' }),
        partner({ _id: 'kid1', partnerOf: 'mid' }),
        partner({ _id: 'kid2', partnerOf: 'mid' }),
      ]);
      const uc = new ErasePartnerUseCase({
        partners: store,
        prospects: counter(0), tickets: counter(0), codes: counter(0), sessions: fakeSessions(),
      });
      const res = await uc.execute({ requesterId: 'admin1', partnerId: 'mid' });
      assert.equal(res.movedDownline, 2);
      assert.equal(res.newUplineId, 'grand');
      assert.deepEqual(store.reassignCalls, [['mid', 'grand']]);
      assert.equal(store.byId.get('kid1').partnerOf, 'grand');
      assert.equal(store.byId.get('kid2').partnerOf, 'grand');
      assert.equal(res.erased.name, 'Deleted');
    } finally {
      fakePartners.downlineCount = 0;
    }
  });

  it('viaSelfRequest allows self-erasure while keeping other guards', async () => {
    const uc = eraseUc([partner({ _id: 'p1' })]);
    const res = await uc.execute({ requesterId: 'p1', partnerId: 'p1', viaSelfRequest: true });
    assert.equal(res.erased.name, 'Deleted');
    assert.equal(res.movedDownline, 0);
    assert.equal(res.newUplineId, null);
  });
});
