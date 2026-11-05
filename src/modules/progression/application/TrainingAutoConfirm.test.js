import test from 'node:test';
import assert from 'node:assert/strict';
import { UpdateMilestonesUseCase } from './Progression.usecases.js';

test('training milestones are recorded as confirmed automatically', async () => {
  let captured = null;
  const progress = {
    upsertMilestones: async (_partnerId, patch, event) => {
      captured = { patch, event };
      return { ...patch };
    },
  };
  const uc = new UpdateMilestonesUseCase({ progress });
  await uc.execute({ partnerId: 'p1', patch: { ipo: { done: true } } });
  assert.ok(captured.patch.ipo.confirmedAt instanceof Date);
  assert.equal(captured.patch.ipo.confirmedBy, null);
  assert.match(captured.event.key, /ipo/);
});
