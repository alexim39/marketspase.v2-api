import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TeamComplianceUseCase } from './Training.usecases.js';

const FULL = {
  ipo: ['ipo-1', 'ipo-2', 'ipo-3'],
  qsg: ['qsg-1', 'qsg-2', 'qsg-3', 'qsg-4'],
  smo: ['smo-1', 'smo-2', 'smo-3'],
  leadership: ['leadership-1', 'leadership-2', 'leadership-3'],
};
const row = (partnerId, courseId, completedLessons) => ({
  partnerId, courseId, completedLessons, certificateAt: completedLessons.length ? new Date() : null,
});

// upline u -> [a, b]; a -> [c]
const fakeNetwork = () => ({
  findChildren: async (parentIds) => {
    const out = [];
    if (parentIds.includes('u')) out.push({ id: 'a' }, { id: 'b' });
    if (parentIds.includes('a')) out.push({ id: 'c' });
    return out;
  },
  findNodesByIds: async (ids) => ids.map((id) => ({
    id, username: `user_${id}`, name: `Name ${id}`, surname: '',
  })),
});

const fakeTraining = (rows) => ({
  listForPartners: async (ids) => rows.filter((r) => ids.includes(String(r.partnerId))),
});

describe('TeamComplianceUseCase', () => {
  it('rolls up per-member progress with depths and labels', async () => {
    const uc = new TeamComplianceUseCase({
      training: fakeTraining([
        row('a', 'ipo', FULL.ipo),
        ...Object.entries(FULL).map(([courseId, lessons]) => row('c', courseId, lessons)),
      ]),
      network: fakeNetwork(),
    });
    const res = await uc.execute({ requesterId: 'u' });
    assert.equal(res.members.length, 3);
    assert.equal(res.total, 3);
    assert.equal(res.capped, false);

    const byId = Object.fromEntries(res.members.map((m) => [m.partnerId, m]));
    assert.equal(byId.a.depth, 1);
    assert.equal(byId.b.depth, 1);
    assert.equal(byId.c.depth, 2);
    assert.equal(byId.a.member.name, 'Name a');

    assert.equal(byId.a.overallPercent, 25); // (100+0+0+0)/4
    assert.equal(byId.a.certifiedCount, 1);
    assert.equal(byId.b.overallPercent, 0);
    assert.equal(byId.b.certifiedCount, 0);
    assert.equal(byId.c.overallPercent, 100);
    assert.equal(byId.c.certifiedCount, 4);
    assert.deepEqual(res.summary, { notStarted: 1, inProgress: 1, fullyCertified: 1 });
  });

  it('empty downline returns empty members and zeroed summary', async () => {
    const uc = new TeamComplianceUseCase({
      training: fakeTraining([]),
      network: { findChildren: async () => [], findNodesByIds: async () => [] },
    });
    const res = await uc.execute({ requesterId: 'lonely' });
    assert.deepEqual(res.members, []);
    assert.equal(res.total, 0);
    assert.deepEqual(res.summary, { notStarted: 0, inProgress: 0, fullyCertified: 0 });
  });

  it('respects the member cap and flags it', async () => {
    const uc = new TeamComplianceUseCase({ training: fakeTraining([]), network: fakeNetwork() });
    const res = await uc.execute({ requesterId: 'u', limit: 2 });
    assert.equal(res.members.length, 2);
    assert.equal(res.capped, true);
  });

  it('members without labels still roll up', async () => {
    const uc = new TeamComplianceUseCase({
      training: fakeTraining([row('a', 'smo', FULL.smo)]),
      network: { ...fakeNetwork(), findNodesByIds: async () => [] },
    });
    const res = await uc.execute({ requesterId: 'u' });
    assert.equal(res.members.length, 3);
    assert.equal(res.members.find((m) => m.partnerId === 'a').member, null);
    assert.equal(res.members.find((m) => m.partnerId === 'a').overallPercent, 25);
  });
});
