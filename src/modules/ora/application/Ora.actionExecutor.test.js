import test from 'node:test';
import assert from 'node:assert/strict';
import { OraActionExecutor } from './Ora.actionExecutor.js';

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
  const calls = { sms: [], email: [], log: [], status: [] };
  const executor = new OraActionExecutor({
    prospects: { findById: async () => p },
    sendSms: { execute: async (input) => { calls.sms.push(input); return { sent: 1, total: 1, cost: 10, status: 'success' }; } },
    sendEmail: { execute: async (input) => { calls.email.push(input); return { sent: 1, total: 1, status: 'success' }; } },
    logCommunication: { execute: async (input) => { calls.log.push(input); return {}; } },
    updateStatus: { execute: async (input) => { calls.status.push(input); return { id: p.id }; } },
  });
  return { executor, calls };
};

test('sends an approved SMS only with consent and owner match', async () => {
  const { executor, calls } = deps();
  const result = await executor.execute({
    partnerId: 'owner-1',
    action: { type: 'send_sms', payload: { prospectId: PID, body: 'Hi Paul, checking in.' } },
  });
  assert.equal(result.sent, 1);
  assert.equal(calls.sms.length, 1);
  assert.equal(calls.log.length, 1);
  assert.equal(calls.log[0].type, 'text');
});

test('blocks automated contact without consent', async () => {
  const { executor, calls } = deps(prospect({ consentToContact: false }));
  await assert.rejects(executor.execute({
    partnerId: 'owner-1',
    action: { type: 'send_sms', payload: { prospectId: PID, body: 'Hi' } },
  }), /not consented/i);
  assert.equal(calls.sms.length, 0);
});

test('blocks a prospect owned by another partner', async () => {
  const { executor } = deps(prospect({ partnerId: 'someone-else' }));
  await assert.rejects(executor.execute({
    partnerId: 'owner-1',
    action: { type: 'send_sms', payload: { prospectId: PID, body: 'Hi' } },
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
