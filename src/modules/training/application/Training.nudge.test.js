import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NudgeMemberUseCase, TeamMemberDetailUseCase } from './Training.usecases.js';

const FULL_IPO = ['ipo-1', 'ipo-2', 'ipo-3'];
const ALL = {
  ipo: FULL_IPO,
  qsg: ['qsg-1', 'qsg-2', 'qsg-3', 'qsg-4'],
  smo: ['smo-1', 'smo-2', 'smo-3'],
  leadership: ['leadership-1', 'leadership-2', 'leadership-3'],
};

// upline u -> [a, b]
const fakeNetwork = (labels = true) => ({
  findChildren: async (parentIds) => (parentIds.includes('u') ? [{ id: 'a' }, { id: 'b' }] : []),
  findNodesByIds: async (ids) => (labels
    ? ids.map((id) => ({ id, username: `user_${id}`, name: `Name ${id}`, surname: '' }))
    : []),
});

const row = (partnerId, courseId, completedLessons) => ({ partnerId, courseId, completedLessons });

const fakeTraining = (rows) => ({
  listForPartners: async (ids) => rows.filter((r) => ids.includes(String(r.partnerId))),
  listByPartner: async (pid) => rows.filter((r) => String(r.partnerId) === String(pid)),
});

const fakeStored = (seed = []) => {
  const keys = new Set(seed);
  return {
    keys,
    findByKey: async (recipientId, key) => (keys.has(`${recipientId}|${key}`) ? { key } : null),
  };
};

const fakeNotify = (calls = []) => ({
  calls,
  execute: async (input) => {
    calls.push(input);
    return { id: 'n1', ...input };
  },
});

describe('TeamMemberDetailUseCase', () => {
  it('returns per-course lessons with done flags', async () => {
    const uc = new TeamMemberDetailUseCase({
      training: fakeTraining([row('a', 'ipo', ['ipo-1'])]),
      network: fakeNetwork(),
    });
    const d = await uc.execute({ requesterId: 'u', partnerId: 'a' });
    assert.equal(d.partnerId, 'a');
    assert.equal(d.depth, 1);
    assert.equal(d.member.name, 'Name a');
    const ipo = d.courses.find((c) => c.courseId === 'ipo');
    assert.equal(ipo.done, 1);
    assert.equal(ipo.lessons.find((l) => l.lessonId === 'ipo-1').done, true);
    assert.equal(ipo.lessons.find((l) => l.lessonId === 'ipo-2').done, false);
    assert.equal(ipo.lessons.find((l) => l.lessonId === 'ipo-1').hasVideo, true);
    assert.equal(ipo.lessons.find((l) => l.lessonId === 'ipo-2').hasVideo, true);
    assert.equal(ipo.lessons.find((l) => l.lessonId === 'ipo-3').hasVideo, true);
    assert.equal(d.overallPercent, Math.round(100 / 3 / 4));
  });

  it('rejects members outside the requester downline', async () => {
    const uc = new TeamMemberDetailUseCase({ training: fakeTraining([]), network: fakeNetwork() });
    await assert.rejects(uc.execute({ requesterId: 'u', partnerId: 'stranger' }), /downline/);
  });
});

describe('NudgeMemberUseCase', () => {
  const trainingFor = (rows) => fakeTraining(rows);

  it('notifies a partial member with the next course in the body', async () => {
    const calls = [];
    const uc = new NudgeMemberUseCase({
      training: trainingFor([row('a', 'ipo', FULL_IPO)]),
      network: fakeNetwork(),
      stored: fakeStored(),
      notify: fakeNotify(calls),
    });
    const res = await uc.execute({ requesterId: 'u', partnerId: 'a', note: 'Keep going!' });
    assert.equal(res.status, 'notified');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].recipientId, 'a');
    assert.equal(calls[0].category, 'training');
    assert.match(calls[0].key, /^training-nudge:a:\d{4}-\d{2}-\d{2}$/);
    assert.match(calls[0].body, /Quick Start Guide/);
    assert.match(calls[0].body, /Keep going!/);
    assert.match(calls[0].link, /training\/courses/);
  });

  it('skips fully certified members without notifying', async () => {
    const calls = [];
    const uc = new NudgeMemberUseCase({
      training: trainingFor(Object.entries(ALL).map(([courseId, lessons]) => row('a', courseId, lessons))),
      network: fakeNetwork(),
      stored: fakeStored(),
      notify: fakeNotify(calls),
    });
    const res = await uc.execute({ requesterId: 'u', partnerId: 'a' });
    assert.equal(res.status, 'skipped');
    assert.equal(res.reason, 'already-complete');
    assert.equal(calls.length, 0);
  });

  it('throttles to one nudge per member per day', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const calls = [];
    const uc = new NudgeMemberUseCase({
      training: trainingFor([]),
      network: fakeNetwork(),
      stored: fakeStored([`b|training-nudge:b:${day}`]),
      notify: fakeNotify(calls),
    });
    const res = await uc.execute({ requesterId: 'u', partnerId: 'b' });
    assert.equal(res.status, 'skipped');
    assert.equal(res.reason, 'already-sent-today');
    assert.equal(calls.length, 0);
  });

  it('rejects targets outside the downline before touching notify', async () => {
    const calls = [];
    const uc = new NudgeMemberUseCase({
      training: trainingFor([]),
      network: fakeNetwork(),
      stored: fakeStored(),
      notify: fakeNotify(calls),
    });
    await assert.rejects(uc.execute({ requesterId: 'u', partnerId: 'stranger' }), /downline/);
    assert.equal(calls.length, 0);
  });
});
