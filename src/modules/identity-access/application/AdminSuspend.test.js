import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SetSuspendUseCase } from './Admin.usecase.js';
import { PlatformStatsUseCase } from './Admin.usecase.js';
import { ListPartnersUseCase } from './Admin.usecase.js';
import { ResetOnBehalfUseCase } from './Admin.usecase.js';
import { SigninUseCase } from './Signin.usecase.js';
import { GetCurrentPartnerUseCase } from './GetCurrentPartner.usecase.js';

const partner = (over = {}) => ({
  _id: 'p1', email: 'a@x.test', role: 'user', password: 'hashed',
  suspendedAt: null, suspendReason: null, ...over,
});

const fakePartners = (rows = []) => {
  const byId = new Map(rows.map((r) => [String(r._id), { ...r }]));
  return {
    byId,
    findById: async (id) => byId.get(String(id)) ?? null,
    findByEmail: async (email) => [...byId.values()].find((r) => r.email === email) ?? null,
    updateById: async (id, patch) => {
      const row = byId.get(String(id));
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    countByRole: async (role) => [...byId.values()].filter((r) => String(r.role).toLowerCase() === role).length,
  };
};

const fakeHasher = { hash: async (p) => `hashed:${p}`, compare: async (p, h) => h === `hashed:${p}` };

describe('SetSuspendUseCase', () => {
  it('suspends with reason and unsuspends cleanly', async () => {
    const partners = fakePartners([partner()]);
    const uc = new SetSuspendUseCase({ partners });
    const off = await uc.execute({ requesterId: 'admin1', partnerId: 'p1', suspended: true, reason: 'Spam posts' });
    assert.equal(off.suspended, true);
    assert.equal(off.suspendReason, 'Spam posts');
    assert.ok(off.suspendedAt);
    assert.equal(off.password, undefined); // still safe-shaped

    const on = await uc.execute({ requesterId: 'admin1', partnerId: 'p1', suspended: false });
    assert.equal(on.suspended, false);
    assert.equal(on.suspendReason, null);
  });

  it('refuses self-suspension', async () => {
    const uc = new SetSuspendUseCase({ partners: fakePartners([partner({ _id: 'me' })]) });
    await assert.rejects(
      uc.execute({ requesterId: 'me', partnerId: 'me', suspended: true }),
      /own account/,
    );
  });

  it('refuses suspending the last admin', async () => {
    const partners = fakePartners([partner({ _id: 'a1', role: 'admin' }), partner({ _id: 'u2' })]);
    const uc = new SetSuspendUseCase({ partners });
    await assert.rejects(
      uc.execute({ requesterId: 'root', partnerId: 'a1', suspended: true }),
      /last admin/,
    );
  });

  it('allows suspending one admin while others remain', async () => {
    const partners = fakePartners([
      partner({ _id: 'a1', role: 'admin' }),
      partner({ _id: 'a2', role: 'admin' }),
    ]);
    const uc = new SetSuspendUseCase({ partners });
    const res = await uc.execute({ requesterId: 'a2', partnerId: 'a1', suspended: true });
    assert.equal(res.suspended, true);
  });

  it('404s unknown partners', async () => {
    const uc = new SetSuspendUseCase({ partners: fakePartners([]) });
    await assert.rejects(
      uc.execute({ requesterId: 'admin1', partnerId: 'ghost', suspended: true }),
      /not found/i,
    );
  });
});

describe('suspension enforcement', () => {
  it('v1 signin rejects suspended accounts', async () => {
    const uc = new SigninUseCase({
      partners: fakePartners([partner({ password: 'hashed:x', suspendedAt: new Date() })]),
      hasher: fakeHasher,
      sessions: { sign: () => 'tok' },
    });
    await assert.rejects(
      uc.execute({ email: 'a@x.test', password: 'x' }),
      /suspended/,
    );
  });

  it('v1 signin still passes clean accounts and stamps login telemetry', async () => {
    let tracked = null;
    const trackedPartners = fakePartners([partner()]);
    trackedPartners.trackLogin = async (id, stamp) => { tracked = { id, stamp }; return null; };
    const uc = new SigninUseCase({
      partners: trackedPartners,
      hasher: { compare: async () => true },
      sessions: { sign: () => 'tok' },
    });
    const res = await uc.execute({ email: 'a@x.test', password: 'x', ip: '1.2.3.4', agent: 'TestAgent/1.0' });
    assert.equal(res.token, 'tok');
    assert.equal(tracked.id, 'p1');
    assert.ok(tracked.stamp.at instanceof Date);
    assert.equal(tracked.stamp.ip, '1.2.3.4');
  });

  it('v1 signin succeeds even when telemetry is absent (legacy fakes)', async () => {
    const uc = new SigninUseCase({
      partners: fakePartners([partner()]),
      hasher: { compare: async () => true },
      sessions: { sign: () => 'tok' },
    });
    const res = await uc.execute({ email: 'a@x.test', password: 'x' });
    assert.equal(res.token, 'tok');
  });

  it('session check rejects suspended accounts', async () => {
    const uc = new GetCurrentPartnerUseCase({
      partners: fakePartners([partner({ suspendedAt: new Date() })]),
    });
    await assert.rejects(uc.execute({ partnerId: 'p1' }), /suspended/);
  });
});

describe('PlatformStatsUseCase', () => {
  it('returns the repo rollup with empty levels when progress is absent', async () => {
    const rollup = { total: 10, new7d: 2, new30d: 5, roles: { user: 7, leader: 1, g8: 1, admin: 1 }, suspended: 1 };
    const uc = new PlatformStatsUseCase({ partners: { platformStats: async () => rollup } });
    assert.deepEqual(await uc.execute(), { ...rollup, levels: {}, unranked: 10 });
  });

  it('merges the journey-rank distribution and reconciles unranked', async () => {
    const rollup = { total: 10, new7d: 2, new30d: 5, roles: { user: 7, leader: 1, g8: 1, admin: 1 }, suspended: 1 };
    const uc = new PlatformStatsUseCase({
      partners: { platformStats: async () => rollup },
      progress: { levelDistribution: async () => ({ partner: 4, kingsman: 3 }) },
    });
    const res = await uc.execute();
    assert.deepEqual(res.levels, { partner: 4, kingsman: 3 });
    assert.equal(res.unranked, 3);
  });

  it('survives a failing distribution read', async () => {
    const rollup = { total: 5, new7d: 0, new30d: 1, roles: { user: 5, leader: 0, g8: 0, admin: 0 }, suspended: 0 };
    const uc = new PlatformStatsUseCase({
      partners: { platformStats: async () => rollup },
      progress: { levelDistribution: async () => { throw new Error('down'); } },
    });
    const res = await uc.execute();
    assert.deepEqual(res.levels, {});
    assert.equal(res.unranked, 5);
  });
});

describe('ListPartnersUseCase', () => {
  const dirPartners = (rows) => ({
    lastArgs: null,
    async listPartners(args) {
      this.lastArgs = args;
      return { items: rows, total: rows.length };
    },
  });

  it('passes role and suspended filters with bounded paging', async () => {
    const repo = dirPartners([{ _id: 'a1', username: 'u1', role: 'admin' }]);
    const uc = new ListPartnersUseCase({ partners: repo });
    const res = await uc.execute({ role: 'admin', suspended: 'yes', limit: 25, skip: 0 });
    assert.equal(res.total, 1);
    assert.deepEqual(repo.lastArgs, { limit: 25, skip: 0, q: '', role: 'admin', suspended: 'yes', login: 'all', hideErased: true });
  });

  it('normalizes role casing and unknown suspended values', async () => {
    const repo = dirPartners([]);
    const uc = new ListPartnersUseCase({ partners: repo });
    await uc.execute({ role: 'Admin', suspended: 'maybe' });
    assert.deepEqual(repo.lastArgs, { limit: 25, skip: 0, q: '', role: 'admin', suspended: 'all', login: 'all', hideErased: true });
  });

  it('passes the login window through', async () => {
    const repo = dirPartners([]);
    const uc = new ListPartnersUseCase({ partners: repo });
    await uc.execute({ login: 'dormant30' });
    assert.deepEqual(repo.lastArgs, { limit: 25, skip: 0, q: '', role: null, suspended: 'all', login: 'dormant30', hideErased: true });
  });

  it('hides erased accounts by default but honors an explicit opt-out', async () => {
    const repo = dirPartners([]);
    const uc = new ListPartnersUseCase({ partners: repo });
    await uc.execute({});
    assert.equal(repo.lastArgs.hideErased, true);
    await uc.execute({ hideErased: false });
    assert.equal(repo.lastArgs.hideErased, false);
  });

  it('clamps paging bounds', async () => {
    const repo = dirPartners([]);
    const uc = new ListPartnersUseCase({ partners: repo });
    const res = await uc.execute({ limit: 5000, skip: -5 });
    assert.equal(res.limit, 100);
    assert.equal(res.skip, 0);
  });
});

describe('SetSuspendUseCase sessions', () => {
  it('revokes live sessions on suspend and clears on unsuspend', async () => {
    const calls = [];
    const sessions = {
      revoke: async (id, opts) => { calls.push(['revoke', id, opts]); },
      clear: async (id) => { calls.push(['clear', id]); },
    };
    const partners = fakePartners([partner()]);
    const uc = new SetSuspendUseCase({ partners, sessions });
    await uc.execute({ requesterId: 'admin1', partnerId: 'p1', suspended: true, reason: 'Abuse' });
    assert.deepEqual(calls[0], ['revoke', 'p1', { reason: 'Abuse', by: 'admin1' }]);
    await uc.execute({ requesterId: 'admin1', partnerId: 'p1', suspended: false });
    assert.deepEqual(calls[1], ['clear', 'p1']);
  });

  it('succeeds without a sessions dep (backwards compatible)', async () => {
    const uc = new SetSuspendUseCase({ partners: fakePartners([partner()]) });
    const res = await uc.execute({ requesterId: 'admin1', partnerId: 'p1', suspended: true });
    assert.equal(res.suspended, true);
  });
});

describe('ResetOnBehalfUseCase', () => {
  it('delegates to the reset flow with the member email', async () => {
    let got = null;
    const uc = new ResetOnBehalfUseCase({
      partners: fakePartners([partner()]),
      reset: { execute: async (input) => { got = input; return { sent: true }; } },
    });
    const res = await uc.execute({ partnerId: 'p1' });
    assert.deepEqual(got, { email: 'a@x.test' });
    assert.deepEqual(res, { sent: true });
  });

  it('404s unknown partners and rejects missing emails', async () => {
    const uc = new ResetOnBehalfUseCase({
      partners: fakePartners([]),
      reset: { execute: async () => ({ sent: true }) },
    });
    await assert.rejects(uc.execute({ partnerId: 'ghost' }), /not found/i);

    const noMail = new ResetOnBehalfUseCase({
      partners: fakePartners([partner({ email: '' })]),
      reset: { execute: async () => ({ sent: true }) },
    });
    await assert.rejects(noMail.execute({ partnerId: 'p1' }), /no email/i);
  });
});
