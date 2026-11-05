import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastNext } from './Analytics.engine.js';
import { GetBenchUseCase } from '../application/Analytics.usecases.js';
import { GetReferralStatsUseCase } from '../../marketing/application/Marketing.usecases.js';

test('forecastNext projects linear pace, floored at zero', () => {
  assert.equal(forecastNext(10, 6), 14);
  assert.equal(forecastNext(0, 0), 0);
  assert.equal(forecastNext(2, 10), 0);
});

test('bench distributes commission ranks and counts leaders', async () => {
  const people = {
    a: 'Builder',
    b: 'Leader',
    c: 'Ambassador',
  };
  const uc = new GetBenchUseCase({
    network: {
      findChildren: async (parentIds) => (parentIds.includes('p1')
        ? Object.keys(people).map((id) => ({ id }))
        : []),
      findNodesByIds: async (ids) => ids.map((id) => ({ id, commissionRank: people[id] })),
    },
    progress: {
      listPendingConfirmations: async () => [{}, {}],
      listPendingNominations: async () => [{}],
    },
  });
  const res = await uc.execute({ partnerId: 'p1' });
  assert.equal(res.total, 3);
  assert.deepEqual(res.distribution, { Builder: 1, Leader: 1, Ambassador: 1 });
  assert.equal(res.leaders, 2);
  assert.equal(res.pendingConfirmations, 2);
  assert.equal(res.pendingNominations, 1);
});

test('bench degrades when the network cannot project ranks', async () => {
  const uc = new GetBenchUseCase({
    network: { findChildren: async () => [] },
    progress: null,
  });
  const res = await uc.execute({ partnerId: 'p1' });
  assert.equal(res.total, 0);
  assert.deepEqual(res.distribution, {});
  assert.equal(res.leaders, 0);
});

test('referral stats shape link, count and recent', async () => {
  const uc = new GetReferralStatsUseCase({
    network: {
      countChildren: async () => 2,
      recentChildren: async () => [{ _id: 'a', name: 'Ada', surname: 'T', username: 'adat', createdAt: new Date() }],
    },
    partners: {},
  });
  const res = await uc.execute({ partnerId: 'p1', username: 'adat' });
  assert.equal(res.link, 'https://c21fg.online/adat');
  assert.equal(res.recruits, 2);
  assert.equal(res.recent.length, 1);
});
