import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_ACTIONS, createAuditEntry } from '../domain/AuditLog.js';
import { ListAuditUseCase } from './Audit.usecases.js';

const fakeStore = (rows = []) => ({
  lastQuery: null,
  async record(input) {
    const row = { id: `a${rows.length + 1}`, ...createAuditEntry(input), createdAt: new Date().toISOString() };
    rows.push(row);
    return row;
  },
  async list(q) {
    this.lastQuery = q;
    let out = [...rows];
    if (q.action) out = out.filter((r) => r.action === q.action);
    if (q.actorId) out = out.filter((r) => r.actorId === q.actorId);
    const total = out.length;
    return { items: out.slice(q.skip, q.skip + q.limit), total, limit: q.limit, skip: q.skip };
  },
});

describe('AUDIT_ACTIONS vocabulary', () => {
  it('covers every money-adjacent and governance decision', () => {
    for (const a of [
      'role.set', 'permission.set', 'account.suspend', 'account.unsuspend',
      'account.signout', 'account.reset-password', 'account.erase',
      'account.reassign-upline',
      'account.view-as',
      'payout.release', 'payout.void', 'withdrawal.decide', 'wallet.credit',
      'campaign.decide', 'order.decide', 'reservation.decide', 'reservation.delete',
      'training.quiz.save', 'training.media.save', 'training.media.revert',
      'ticket.decide', 'moderation.remove', 'moderation.dismiss',
      'broadcast.send', 'broadcast.campaign.queue', 'broadcast.campaign.cancel',
      'broadcast.campaign.retry', 'broadcast.delete', 'lead.import',
      'lead.delete', 'lead.status', 'pagelead.delete', 'pagelead.reassign',
      'partnersurvey.delete', 'page.reset',
      'subscription.delete', 'subscription.status',
      'billing.plan.update', 'product.create', 'product.update',
      'bonus.claim', 'bonus.campaign.create', 'bonus.campaign.update',
      'tutorial.create', 'tutorial.update', 'tutorial.delete',
    ]) {
      assert.ok(AUDIT_ACTIONS.includes(a), `missing ${a}`);
    }
  });
});

describe('createAuditEntry', () => {
  it('rejects unknown actions (typos fail loudly)', () => {
    assert.throws(() => createAuditEntry({ actorId: 'u', action: 'role.ste' }), /Unknown audit action/);
  });

  it('requires an actor', () => {
    assert.throws(() => createAuditEntry({ action: 'role.set' }), /actorId/);
  });

  it('builds a bounded entry with optional fields', () => {
    const e = createAuditEntry({
      actorId: 'u1', actorLabel: 'Admin One', action: 'role.set',
      targetType: 'partner', targetId: 'p2', detail: { to: 'admin' },
    });
    assert.equal(e.actorId, 'u1');
    assert.equal(e.action, 'role.set');
    assert.equal(e.detail.to, 'admin');
  });
});

describe('ListAuditUseCase', () => {
  it('passes filters through with sane pagination', async () => {
    const store = fakeStore();
    await store.record({ actorId: 'u1', action: 'role.set', targetType: 'partner', targetId: 'p1' });
    await store.record({ actorId: 'u2', action: 'payout.release', targetType: 'cart', targetId: 'c1' });
    const uc = new ListAuditUseCase({ audit: store });
    const res = await uc.execute({ action: 'role.set' });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].actorId, 'u1');
    assert.equal(store.lastQuery.limit, 50);
  });

  it('rejects unknown action filters', async () => {
    const uc = new ListAuditUseCase({ audit: fakeStore() });
    await assert.rejects(uc.execute({ action: 'nope' }), /Unknown audit action/);
  });
});
