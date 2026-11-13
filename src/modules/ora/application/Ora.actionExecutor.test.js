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
  const calls = { log: [], status: [], plan: [], mail: [], sms: [] };
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
    mail: async (to, subject, body, options) => {
      calls.mail.push({ to, subject, body, options });
      return { sent: true };
    },
    sms: {
      send: async (input) => {
        calls.sms.push(input);
        return { providerId: 'sms-1' };
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

test('sends an approved follow-up by SMS and logs the communication', async () => {
  const { executor, calls } = deps();
  const result = await executor.execute({
    partnerId: 'owner-1',
    action: {
      type: 'send_followup',
      payload: { prospectId: PID, channel: 'sms', subject: 'Checking in', body: 'Hi Paul, is this week still good?' },
    },
  });
  assert.equal(result.type, 'send_followup');
  assert.equal(result.channel, 'sms');
  assert.equal(calls.sms.length, 1);
  assert.equal(calls.sms[0].to, '08030000000');
  assert.match(calls.log[0].description, /Ora-approved sms follow-up/i);
});

test('sends an approved follow-up by email when requested', async () => {
  const { executor, calls } = deps();
  const result = await executor.execute({
    partnerId: 'owner-1',
    action: {
      type: 'send_followup',
      payload: { prospectId: PID, channel: 'email', subject: 'Checking in', body: 'Hi Paul, is this week still good?' },
    },
  });
  assert.equal(result.channel, 'email');
  assert.equal(calls.mail.length, 1);
  assert.equal(calls.mail[0].to, 'paul@example.com');
  assert.equal(calls.sms.length, 0);
});

test('refuses an approved send without prospect consent', async () => {
  const { executor } = deps(prospect({ consentToContact: false }));
  await assert.rejects(executor.execute({
    partnerId: 'owner-1',
    action: {
      type: 'send_followup',
      payload: { prospectId: PID, channel: 'sms', body: 'Hi Paul' },
    },
  }), /not consented/i);
});

test('blocks a repeat send within six hours', async () => {
  const { executor } = deps(prospect({
    communications: [{ description: 'Ora-approved sms follow-up: earlier message', date: new Date().toISOString() }],
  }));
  await assert.rejects(executor.execute({
    partnerId: 'owner-1',
    action: {
      type: 'send_followup',
      payload: { prospectId: PID, channel: 'sms', body: 'Hi Paul' },
    },
  }), /last 6 hours/i);
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
