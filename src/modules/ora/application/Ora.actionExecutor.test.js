import test from 'node:test';
import assert from 'node:assert/strict';
import { OraActionExecutor } from './Ora.actionExecutor.js';
import { normalizePlanItems } from '../domain/Ora.plans.js';

const PID = '507f1f77bcf86cd799439011';
const prospect = (over = {}) => ({
  id: PID,
  partnerId: 'owner-1',
  prospectName: 'Paul',
  prospectSurname: 'Obi',
  prospectPhone: '08030000000',
  prospectEmail: 'paul@example.com',
  consentToContact: true,
  ...over,
});

const deps = (p = prospect()) => {
  const calls = { log: [], status: [], plan: [] };
  const executor = new OraActionExecutor({
    prospects: { findById: async () => p },
    logCommunication: { execute: async (input) => { calls.log.push(input); return {}; } },
    updateStatus: { execute: async (input) => { calls.status.push(input); return { id: p.id }; } },
    savePlan: {
      execute: async (input) => {
        calls.plan.push(input);
        return { dateKey: '2026-11-07', items: normalizePlanItems(input.items) };
      },
    },
  });
  return { executor, calls };
};

test('blocks a prospect owned by another partner', async () => {
  const { executor } = deps(prospect({ partnerId: 'someone-else' }));
  await assert.rejects(executor.execute({
    partnerId: 'owner-1',
    action: { type: 'advance_stage', payload: { prospectId: PID, stage: 'Interested' } },
  }), /not in your pipeline/i);
});

test('advances a stage after approval', async () => {
  const { executor, calls } = deps();
  const result = await executor.execute({
    partnerId: 'owner-1',
    action: { type: 'advance_stage', payload: { prospectId: PID, stage: 'Interested' } },
  });
  assert.equal(result.stage, 'Interested');
  assert.equal(calls.status[0].status.stage, 'Interested');
});

test('saves an approved daily plan for the current partner', async () => {
  const { executor, calls } = deps();
  const result = await executor.execute({
    partnerId: 'owner-1',
    action: {
      type: 'save_daily_plan',
      payload: {
        items: [
          { title: 'Follow up with Paul', link: '/dashboard/prospects/pipeline' },
          { title: 'Review goal pace', link: '/dashboard/goals' },
        ],
      },
    },
  });
  assert.equal(result.type, 'save_daily_plan');
  assert.equal(result.dateKey, '2026-11-07');
  assert.equal(result.items.length, 2);
  assert.equal(calls.plan[0].partnerId, 'owner-1');
});

test('an empty approved plan is rejected', async () => {
  const { executor } = deps();
  await assert.rejects(executor.execute({
    partnerId: 'owner-1',
    action: { type: 'save_daily_plan', payload: { items: [] } },
  }), /at least one plan item/i);
});
