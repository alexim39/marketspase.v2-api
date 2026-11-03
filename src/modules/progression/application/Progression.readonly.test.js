import test from 'node:test';
import assert from 'node:assert/strict';
import { GetMyProgressionUseCase } from './Progression.usecases.js';

// Coaching reads (upline/admin viewing a member) must never mutate the
// ladder, post recognition, or fan out promotion events.

const doc = (level = 'partner') => ({
  level,
  ipo: { done: true, confirmedAt: new Date() },
  qsg: { done: true, confirmedAt: new Date() },
});

const deps = (over = {}) => ({
  progress: {
    ensure: async () => doc(),
    setLevel: async () => { throw new Error('must not mutate'); },
    levelsFor: async () => ({}),
  },
  network: {
    countChildren: async () => 1,
    findChildren: async () => [],
    findNode: async () => { throw new Error('must not read for fan-out'); },
  },
  orders: {
    volumeBetween: async () => ({ total: 0 }),
    activeMemberCount: async () => 0,
    recruitsBetween: async () => 1,
  },
  recognition: { promotion: async () => { throw new Error('must not post'); } },
  events: { emit: async () => { throw new Error('must not emit'); } },
  prospects: {},
  community: {},
  eventStore: {},
  reports: {},
  ...over,
});

test('readOnly resolves the ladder without mutating or celebrating', async () => {
  const uc = new GetMyProgressionUseCase(deps());
  const res = await uc.execute({ partnerId: 'p1', readOnly: true });
  // 1 recruit + confirmed IPO/QSG → qualified_active, without promotion write.
  assert.equal(res.level, 'qualified_active');
  assert.equal(res.promoted, null);
});

test('normal reads still promote', async () => {
  let leveled = null;
  let celebrated = 0;
  const uc = new GetMyProgressionUseCase(deps({
    progress: {
      ensure: async () => doc(),
      setLevel: async (id, level) => { leveled = level; },
      levelsFor: async () => ({}),
    },
    network: {
      countChildren: async () => 1,
      findChildren: async () => [],
      findNode: async () => ({ name: 'A', surname: 'B', username: 'ab', parentId: null }),
    },
    orders: {
      volumeBetween: async () => ({ total: 0 }),
      activeMemberCount: async () => 0,
      recruitsBetween: async () => 1,
    },
    recognition: { promotion: async () => { celebrated += 1; } },
  }));
  const res = await uc.execute({ partnerId: 'p1' });
  assert.equal(leveled, 'qualified_active');
  assert.equal(celebrated, 1);
  assert.ok(res.promoted);
});
