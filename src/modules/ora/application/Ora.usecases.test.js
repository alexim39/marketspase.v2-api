import test from 'node:test';
import assert from 'node:assert/strict';
import { AskOraUseCase, ApproveOraActionUseCase, materializeProposals } from './Ora.usecases.js';

const snapshot = {
  opportunities: [
    {
      id: 'opp:followup:507f1f77bcf86cd799439011',
      type: 'send_sms',
      area: 'Pipeline',
      title: 'Follow up with Paul',
      reason: 'Overdue by 2 days',
      page: '/dashboard/prospects/pipeline',
      capabilityKey: 'pipeline.followups',
      summary: 'Short check-in SMS ready',
      payload: { prospectId: '507f1f77bcf86cd799439011', body: 'Default draft' },
    },
    {
      id: 'opp:review:507f1f77bcf86cd799439012',
      type: 'open_page',
      area: 'Pipeline',
      title: 'Review Ada',
      reason: 'Consent not recorded',
      page: '/dashboard/prospects/pipeline',
      capabilityKey: 'pipeline.followups',
      summary: '',
      payload: {},
    },
  ],
};

const actionStore = () => ({
  created: [],
  countProposed: async () => 0,
  async create(action) {
    const row = { id: `a${this.created.length + 1}`, ...action, status: 'proposed', requiresApproval: true };
    this.created.push(row);
    return row;
  },
});

test('materializes an opportunity into a persisted approval action', async () => {
  const actions = actionStore();
  const out = await materializeProposals({
    partnerId: 'p1',
    conversationId: 'c1',
    snapshot,
    actions,
    proposals: [{
      opportunityId: 'opp:followup:507f1f77bcf86cd799439011',
      label: 'Send reminder SMS',
      summary: 'Short check-in to Paul',
      draft: 'Hi Paul, are you still interested?',
    }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'send_sms');
  assert.equal(out[0].status, 'proposed');
  assert.equal(out[0].requiresApproval, true);
  assert.equal(out[0].payload.body, 'Hi Paul, are you still interested?');
  assert.equal(actions.created.length, 1);
});

test('open-page opportunities and capability proposals are not persisted as approvals', async () => {
  const actions = actionStore();
  const out = await materializeProposals({
    partnerId: 'p1',
    conversationId: 'c1',
    snapshot,
    actions,
    proposals: [
      { opportunityId: 'opp:review:507f1f77bcf86cd799439012', label: 'Review Ada' },
      { capability: 'pipeline.reminders', label: 'Open reminders' },
    ],
  });
  assert.equal(out.length, 2);
  assert.ok(out.every((action) => action.type === 'open_page' && action.requiresApproval === false));
  assert.equal(out[1].link, '/dashboard/prospects/reminders');
  assert.equal(actions.created.length, 0);
});

test('unknown ids are dropped', async () => {
  const out = await materializeProposals({
    partnerId: 'p1',
    conversationId: 'c1',
    snapshot,
    proposals: [{ opportunityId: 'missing' }, { capability: 'missing' }],
  });
  assert.deepEqual(out, []);
});

test('a daily plan proposal keeps the server payload and applies the model draft', async () => {
  const actions = actionStore();
  const planSnapshot = {
    opportunities: [{
      id: 'opp:plan:today',
      type: 'save_daily_plan',
      area: 'Home',
      title: "Save today's plan",
      reason: 'Three priorities ready',
      page: '/dashboard/ora',
      capabilityKey: 'home.plan',
      summary: 'Plan ready',
      payload: { dateKey: '2026-11-07', items: [{ title: 'Default item' }] },
    }],
  };
  const out = await materializeProposals({
    partnerId: 'p1',
    conversationId: 'c1',
    snapshot: planSnapshot,
    actions,
    proposals: [{
      opportunityId: 'opp:plan:today',
      label: 'Save today\'s plan',
      draft: '[{"title":"Follow up with Paul","link":"/dashboard/prospects/pipeline"}]',
    }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'save_daily_plan');
  assert.equal(out[0].status, 'proposed');
  assert.equal(out[0].payload.dateKey, '2026-11-07');
  assert.equal(out[0].payload.items[0].title, 'Follow up with Paul');
  assert.equal(out[0].payload.items[0].link, '/dashboard/prospects/pipeline');
});

test('a plan proposal without a draft uses the numbered reply list', async () => {
  const actions = actionStore();
  const planSnapshot = {
    opportunities: [{
      id: 'opp:plan:today',
      type: 'save_daily_plan',
      area: 'Home',
      title: "Save today's plan",
      reason: 'Three priorities ready',
      page: '/dashboard/ora',
      capabilityKey: 'home.plan',
      summary: 'Plan ready',
      payload: { dateKey: '2026-11-07', items: [{ title: 'Default item' }] },
    }],
  };
  const out = await materializeProposals({
    partnerId: 'p1',
    conversationId: 'c1',
    snapshot: planSnapshot,
    actions,
    reply: 'Here is the plan:\n1. Follow up with Paul — overdue by two days\n2. Check goal pace',
    proposals: [{ opportunityId: 'opp:plan:today', label: 'Save today\'s plan' }],
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].payload.items.map((item) => item.title), ['Follow up with Paul', 'Check goal pace']);
});

test('a pipeline question still yields an approval card when the model omits one', async () => {
  const created = [];
  const conversations = {
    async create(partnerId, title) {
      return { id: 'c1', partnerId, title, messages: [] };
    },
    async findById() { return null; },
    async appendMessage(id, message) {
      void id;
      void message;
      return {};
    },
  };
  const actions = {
    async countProposed() { return 0; },
    async create(action) {
      const row = { id: `a${created.length + 1}`, ...action, status: 'proposed', requiresApproval: true };
      created.push(row);
      return row;
    },
  };
  const usecase = new AskOraUseCase({
    conversations,
    client: { complete: async () => 'You have 2 overdue follow-ups. Should I send Paul a reminder?' },
    context: { assemble: async () => snapshot },
    actions,
  });

  const out = await usecase.execute({ partnerId: 'p1', message: 'What is my pipeline status?' });

  assert.equal(out.actions.length, 1);
  assert.equal(out.actions[0].type, 'send_sms');
  assert.equal(out.actions[0].payload.body, 'Default draft');
  assert.equal(created.length, 1);
});

test('approval claims once, executes once and returns the existing result afterwards', async () => {
  const state = { status: 'proposed', executions: 0 };
  const stored = {
    id: 'a1', type: 'send_sms', opportunityId: 'opp:1',
    payload: { prospectId: '507f1f77bcf86cd799439011' },
    status: 'proposed',
  };
  const actions = {
    async claimForExecution() {
      if (state.status !== 'proposed') return null;
      state.status = 'executing';
      return { ...stored, status: 'executing' };
    },
    async findById() {
      return state.status === 'executed'
        ? { ...stored, status: 'executed', result: { sent: 1 } }
        : { ...stored, status: state.status };
    },
    async markExecuted(_id, result) {
      state.status = 'executed';
      return { ...stored, status: 'executed', result };
    },
    async markFailed() { state.status = 'failed'; return {}; },
  };
  const executor = {
    async execute() { state.executions += 1; return { sent: 1, total: 1 }; },
  };
  const approve = new ApproveOraActionUseCase({ actions, executor });

  const first = await approve.execute({ partnerId: 'p1', actionId: 'a1' });
  assert.equal(first.status, 'executed');
  assert.equal(state.executions, 1);

  const second = await approve.execute({ partnerId: 'p1', actionId: 'a1' });
  assert.equal(second.status, 'executed');
  assert.equal(state.executions, 1);
});
