import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runProgressionDemotionJob } from './progression-demotion.js';

const config = { enabled: true, graceDays: 30, cycles: 2, maxSteps: 1 };
const now = new Date('2026-03-01T00:00:00Z');

const build = (overrides = {}) => {
  const calls = [];
  const progress = {
    async listDemotionCandidates() {
      return [{
        partnerId: 'p1',
        level: 'leader',
        levelAt: new Date('2025-01-01T00:00:00Z'),
        lastPromotionAt: new Date('2025-01-01T00:00:00Z'),
        demotionMisses: 1,
      }];
    },
    async resetDemotionMisses(id) { calls.push(['reset', id]); },
    async incrementDemotionMisses(id) { calls.push(['increment', id]); },
    async demoteLevel(id, level) { calls.push(['demote', id, level]); },
    ...(overrides.progress ?? {}),
  };
  const events = {
    emitted: [],
    async emit(event, payload) { this.emitted.push({ event, payload }); },
  };
  return { calls, progress, events };
};

describe('progression demotion job', () => {
  it('demotes after consecutive maintenance failures and emits the event', async () => {
    const { calls, progress, events } = build();
    const result = await runProgressionDemotionJob({
      config,
      now,
      progress,
      events,
      network: { async findNode() { return { name: 'Ada', surname: 'Obi', username: 'ada', parentId: 'u1' }; } },
      mine: { async execute() { return { signals: { maintenanceOk: false } }; } },
    });

    assert.equal(result.demoted, 1);
    assert.deepEqual(calls, [['demote', 'p1', 'builder']]);
    assert.equal(events.emitted.length, 1);
    assert.equal(events.emitted[0].event, 'progression.demoted');
    assert.equal(events.emitted[0].payload.fromLabel, 'Leader');
    assert.equal(events.emitted[0].payload.toLabel, 'Builder');
  });

  it('resets misses when maintenance recovers and skips during grace', async () => {
    const { calls, progress, events } = build();
    const result = await runProgressionDemotionJob({
      config,
      now,
      progress,
      events,
      network: { async findNode() { return null; } },
      mine: { async execute() { return { signals: { maintenanceOk: true } }; } },
    });
    assert.equal(result.reset, 1);
    assert.deepEqual(calls, [['reset', 'p1']]);

    const graceCalls = [];
    const graceProgress = {
      ...progress,
      async listDemotionCandidates() {
        return [{
          partnerId: 'p2', level: 'leader', levelAt: new Date('2026-02-20T00:00:00Z'),
          lastPromotionAt: new Date('2026-02-20T00:00:00Z'), demotionMisses: 0,
        }];
      },
      async demoteLevel(...args) { graceCalls.push(args); },
    };
    const grace = await runProgressionDemotionJob({
      config, now, progress: graceProgress, events,
      network: { async findNode() { return null; } },
      mine: { async execute() { return { signals: { maintenanceOk: false } }; } },
    });
    assert.equal(grace.skipped, 1);
    assert.equal(graceCalls.length, 0);
  });
});
