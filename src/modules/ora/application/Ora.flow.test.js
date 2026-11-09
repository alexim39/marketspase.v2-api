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
    id: `opp:stage:${PID}`,
    type: 'advance_stage',
    area: 'Pipeline',
    title: 'Advance Paul',
    reason: 'Ready for the next stage',
    page: '/dashboard/prospects/pipeline',
    capabilityKey: 'pipeline.followups',
    summary: 'Move to Interested',
    payload: { prospectId: PID, stage: 'Interested' },
  }],
});

const modelReply = () => [
  'Paul is ready for the next stage. Approve the move when you are ready.',
  '',
  '```actions',
  JSON.stringify([{
    opportunityId: `opp:stage:${PID}`,
    label: 'Move Paul to Interested',
    summary: 'Pipeline stage update',
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
  status: { stage: 'Contacted' },
  ...over,
});

const buildFlow = ({ lead = prospect() } = {}) => {
  const store = actionStore();
  const stages = [];
  const audit = [];
  const executor = new OraActionExecutor({
    prospects: { findById: async () => lead },
    logCommunication: { execute: async () => ({}) },
    updateStatus: { execute: async (input) => { stages.push(input); return { id: PID }; } },
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
  return { store, stages, audit, ask, approve };
};

test('a chat proposal becomes one approval card and executes once after approval', async () => {
  const { store, stages, audit, ask, approve } = buildFlow();

  const turn = await ask.execute({ partnerId: OWNER, message: 'Advance Paul in my pipeline' });

  assert.equal(turn.actions.length, 1);
  assert.equal(turn.actions[0].type, 'advance_stage');
  assert.equal(turn.actions[0].status, 'proposed');
  assert.equal(store.rows.size, 1);

  const first = await approve.execute({ partnerId: OWNER, actionId: turn.actions[0].id });
  assert.equal(first.status, 'executed');
  assert.equal(stages.length, 1);

  const second = await approve.execute({ partnerId: OWNER, actionId: turn.actions[0].id });
  assert.equal(second.status, 'executed');
  assert.equal(stages.length, 1, 'approving twice must not execute twice');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'ora.action.execute');
});

test('a lead owned by another partner cannot be advanced', async () => {
  const { stages, ask, approve } = buildFlow({ lead: prospect({ partnerId: 'partner-2' }) });

  const turn = await ask.execute({ partnerId: OWNER, message: 'Advance Paul' });
  await assert.rejects(
    approve.execute({ partnerId: OWNER, actionId: turn.actions[0].id }),
    /not in your pipeline/i,
  );
  assert.equal(stages.length, 0);
});
