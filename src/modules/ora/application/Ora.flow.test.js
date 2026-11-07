import test from 'node:test';
import assert from 'node:assert/strict';
import { AskOraUseCase, ApproveOraActionUseCase } from './Ora.usecases.js';
import { OraActionExecutor } from './Ora.actionExecutor.js';

const PID = '507f1f77bcf86cd799439011';
const OWNER = 'partner-1';

const snapshot = () => ({
  displayName: 'Ada',
  level: 3,
  levelLabel: 'Builder',
  opportunities: [{
    id: `opp:followup:${PID}`,
    type: 'send_sms',
    area: 'Pipeline',
    title: 'Follow up with Paul',
    reason: 'Overdue by 2 days',
    page: '/dashboard/prospects/pipeline',
    capabilityKey: 'pipeline.followups',
    summary: 'Short check-in SMS ready',
    payload: { prospectId: PID, body: 'Default draft' },
  }],
});

const modelReply = () => [
  'Paul is overdue by two days. Here is a short check-in you can approve.',
  '',
  '```actions',
  JSON.stringify([{
    opportunityId: `opp:followup:${PID}`,
    label: 'Send reminder SMS',
    summary: 'Short check-in to Paul',
    draft: 'Hi Paul, just checking in. Still interested?',
  }]),
  '```',
].join('\n');

const conversations = () => {
  const messages = [];
  return {
    messages,
    async create(partnerId, title) {
      return { id: 'c1', partnerId, title, messages };
    },
    async findById() { return null; },
    async appendMessage(_id, message) {
      messages.push(message);
      return message;
    },
  };
};

const actionStore = () => {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    async countProposed(partnerId) {
      return [...rows.values()].filter((r) => r.partnerId === partnerId && r.status === 'proposed').length;
    },
    async create(action) {
      const row = {
        id: `a${++seq}`,
        ...action,
        status: 'proposed',
        requiresApproval: true,
        result: null,
        error: null,
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async findById(partnerId, id) {
      const row = rows.get(id);
      return row && row.partnerId === partnerId ? { ...row } : null;
    },
    async claimForExecution(partnerId, id) {
      const row = rows.get(id);
      if (!row || row.partnerId !== partnerId || row.status !== 'proposed') return null;
      row.status = 'executing';
      return { ...row };
    },
    async markExecuted(id, result) {
      const row = rows.get(id);
      row.status = 'executed';
      row.result = result;
      return { ...row };
    },
    async markFailed(id, error) {
      const row = rows.get(id);
      row.status = 'failed';
      row.error = error;
      return { ...row };
    },
  };
};

const prospect = (over = {}) => ({
  id: PID,
  partnerId: OWNER,
  prospectName: 'Paul',
  prospectPhone: '08030000000',
  prospectEmail: 'paul@example.com',
  consentToContact: true,
  status: { stage: 'Contacted' },
  ...over,
});

const buildFlow = ({ lead = prospect() } = {}) => {
  const store = actionStore();
  const sms = [];
  const audit = [];
  const executor = new OraActionExecutor({
    prospects: { findById: async () => lead },
    sendSms: {
      execute: async (input) => {
        sms.push(input);
        return { sent: 1, total: 1, cost: 6.49, status: 'success' };
      },
    },
    sendEmail: { execute: async () => ({ sent: 1, total: 1, status: 'success' }) },
    logCommunication: { execute: async () => ({}) },
    updateStatus: { execute: async () => ({ id: PID }) },
  });
  const ask = new AskOraUseCase({
    conversations: conversations(),
    client: { complete: async () => modelReply() },
    context: { assemble: async () => snapshot() },
    actions: store,
  });
  const approve = new ApproveOraActionUseCase({
    actions: store,
    executor,
    audit: (event) => { audit.push(event); return Promise.resolve(); },
  });
  return { store, sms, audit, ask, approve };
};

test('a chat proposal becomes one approval card and sends once after approval', async () => {
  const { store, sms, audit, ask, approve } = buildFlow();

  const turn = await ask.execute({ partnerId: OWNER, message: 'What is my pipeline status?' });

  assert.equal(turn.actions.length, 1);
  assert.equal(turn.actions[0].type, 'send_sms');
  assert.equal(turn.actions[0].status, 'proposed');
  assert.equal(turn.actions[0].payload.body, 'Hi Paul, just checking in. Still interested?');
  assert.equal(store.rows.size, 1);

  const first = await approve.execute({ partnerId: OWNER, actionId: turn.actions[0].id });
  assert.equal(first.status, 'executed');
  assert.equal(first.result.sent, 1);
  assert.equal(sms.length, 1);
  assert.equal(sms[0].to[0], '08030000000');

  const second = await approve.execute({ partnerId: OWNER, actionId: turn.actions[0].id });
  assert.equal(second.status, 'executed');
  assert.equal(sms.length, 1, 'approving twice must not send twice');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'ora.action.execute');
});

test('a manual lead without consent cannot execute an approved SMS', async () => {
  const { sms, ask, approve, store } = buildFlow({
    lead: prospect({ consentToContact: false, prospectSource: 'Manual' }),
  });

  const turn = await ask.execute({ partnerId: OWNER, message: 'Follow up with Paul' });
  await assert.rejects(
    approve.execute({ partnerId: OWNER, actionId: turn.actions[0].id }),
    /not consented/i,
  );
  assert.equal(sms.length, 0);
  assert.equal(store.rows.get(turn.actions[0].id).status, 'failed');
});

test('a lead owned by another partner cannot be contacted', async () => {
  const { sms, ask, approve } = buildFlow({ lead: prospect({ partnerId: 'partner-2' }) });

  const turn = await ask.execute({ partnerId: OWNER, message: 'Follow up with Paul' });
  await assert.rejects(
    approve.execute({ partnerId: OWNER, actionId: turn.actions[0].id }),
    /not in your pipeline/i,
  );
  assert.equal(sms.length, 0);
});
