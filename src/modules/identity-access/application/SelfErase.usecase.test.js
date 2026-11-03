import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RequestSelfErasureUseCase, CancelSelfErasureUseCase, ERASE_COOLDOWN_DAYS,
} from './SelfErase.usecase.js';

const DAY = 86400000;

const fakePartners = (rows = [], extra = {}) => {
  const byId = new Map(rows.map((r) => [String(r._id), { ...r }]));
  return {
    writes: [],
    downline: extra.downline ?? 0,
    admins: extra.admins ?? 2,
    async findById(id) {
      const r = byId.get(String(id));
      return r ? { ...r } : null;
    },
    async updateById(id, patch) {
      this.writes.push({ id: String(id), patch });
      const r = byId.get(String(id));
      if (!r) return null;
      Object.assign(r, patch);
      return { ...r };
    },
    async countDownline() { return this.downline; },
    async countByRole() { return this.admins; },
  };
};

const member = (over = {}) => ({
  _id: 'p1', name: 'Ama', surname: 'K', username: 'amak',
  email: 'a@x.test', role: 'user', balance: 0,
  eraseRequestedAt: null, eraseScheduledFor: null, eraseReminderAt: null,
  ...over,
});

describe('RequestSelfErasureUseCase', () => {
  it('stamps a 30-day schedule and returns the dates', async () => {
    const partners = fakePartners([member()]);
    const uc = new RequestSelfErasureUseCase({ partners });
    const before = Date.now();
    const res = await uc.execute({ partnerId: 'p1' });
    const scheduled = new Date(res.scheduledFor).getTime();
    assert.ok(scheduled - before >= ERASE_COOLDOWN_DAYS * DAY - 5000);
    assert.ok(scheduled - before <= ERASE_COOLDOWN_DAYS * DAY + 5000);
    assert.equal(ERASE_COOLDOWN_DAYS, 30);
    assert.equal(partners.writes.length, 1);
    assert.ok(partners.writes[0].patch.eraseScheduledFor instanceof Date);
    assert.equal(partners.writes[0].patch.eraseReminderAt, null);
  });

  it('refuses a second request while one is pending (no clock reset)', async () => {
    const when = new Date(Date.now() + 10 * DAY);
    const partners = fakePartners([member({ eraseRequestedAt: new Date(), eraseScheduledFor: when })]);
    const uc = new RequestSelfErasureUseCase({ partners });
    await assert.rejects(uc.execute({ partnerId: 'p1' }), /already scheduled/);
    assert.equal(partners.writes.length, 0);
  });

  it('blocks members with downline and the last admin', async () => {
    const busy = fakePartners([member()], { downline: 4 });
    await assert.rejects(
      new RequestSelfErasureUseCase({ partners: busy }).execute({ partnerId: 'p1' }),
      /Reassign 4 downline/,
    );
    const solo = fakePartners([member({ role: 'admin' })], { admins: 1 });
    await assert.rejects(
      new RequestSelfErasureUseCase({ partners: solo }).execute({ partnerId: 'p1' }),
      /last admin/,
    );
  });

  it('allows mid-tree members with downline (sweep moves them at execution)', async () => {
    const partners = fakePartners([member({ partnerOf: 'grand1' })], { downline: 3 });
    const uc = new RequestSelfErasureUseCase({ partners });
    const res = await uc.execute({ partnerId: 'p1' });
    assert.ok(res.scheduledFor);
    assert.equal(partners.writes.length, 1);
  });

  it('404s unknown partners', async () => {
    await assert.rejects(
      new RequestSelfErasureUseCase({ partners: fakePartners([]) }).execute({ partnerId: 'ghost' }),
      /not found/i,
    );
  });
});

describe('CancelSelfErasureUseCase', () => {
  it('clears a pending request', async () => {
    const partners = fakePartners([member({ eraseRequestedAt: new Date(), eraseScheduledFor: new Date() })]);
    const uc = new CancelSelfErasureUseCase({ partners });
    assert.deepEqual(await uc.execute({ partnerId: 'p1' }), { cancelled: true });
    assert.equal(partners.writes[0].patch.eraseScheduledFor, null);
  });

  it('is idempotent when nothing is pending', async () => {
    const partners = fakePartners([member()]);
    const uc = new CancelSelfErasureUseCase({ partners });
    assert.deepEqual(await uc.execute({ partnerId: 'p1' }), { cancelled: false });
    assert.equal(partners.writes.length, 0);
  });
});
