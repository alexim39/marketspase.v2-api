import test from 'node:test';
import assert from 'node:assert/strict';
import { AskOraUseCase, ApproveOraActionUseCase, materializeProposals } from './Ora.usecases.js';
import { InMemoryOraUsageStore } from '../domain/Ora.usage.js';

const snapshot = {
  opportunities: [
    {
      id: 'opp:followup:507f1f77bcf86cd799439011',
      type: 'advance_stage',
      area: 'Pipeline',
      title: 'Advance Paul',
      reason: 'Overdue by 2 days',
      page: '/dashboard/prospects/pipeline',
      capabilityKey: 'pipeline.followups',
      summary: 'Move to Interested',
      payload: { prospectId: '507f1f77bcf86cd799439011', stage: 'Interested' },
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

const fakeConversations = () => ({
  async create(partnerId, title) {
    return { id: 'c1', partnerId, title, messages: [] };
  },
  async findById() { return null; },
  async appendMessage() { return {}; },
});

const askWithLimit = (dailyLimit) => new AskOraUseCase({
  conversations: fakeConversations(),
  client: { complete: async () => 'That is the next step.' },
  context: { assemble: async () => snapshot },
  dailyLimit,
});

const askWithStore = (usageStore, dailyLimit = 25) => new AskOraUseCase({
  conversations: fakeConversations(),
  client: { complete: async () => 'That is the next step.' },
  context: { assemble: async () => snapshot },
  dailyLimit,
  usageStore,
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
      label: 'Move Paul to Interested',
      summary: 'Pipeline stage update',
    }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'advance_stage');
  assert.equal(out[0].status, 'proposed');
  assert.equal(out[0].requiresApproval, true);
  assert.equal(out[0].payload.stage, 'Interested');
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

test('a handoff proposal becomes a consent-aware approval action', async () => {
  const actions = actionStore();
  const out = await materializeProposals({
    partnerId: 'p1',
    conversationId: 'c1',
    snapshot,
    actions,
    proposals: [{
      capability: 'support.handoff',
      target: 'mentor',
      reason: 'Needs activation help',
      label: 'Ask my mentor to reach out',
    }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'request_handoff');
  assert.equal(out[0].requiresApproval, true);
  assert.equal(out[0].payload.target, 'mentor');
  assert.equal(out[0].payload.reason, 'Needs activation help');
  assert.equal(actions.created.length, 1);
});

test('a human request still yields a support handoff when the model omits actions', async () => {
  const actions = actionStore();
  const ask = new AskOraUseCase({
    conversations: fakeConversations(),
    client: { complete: async () => 'I can help with that.' },
    context: { assemble: async () => ({ ...snapshot, sponsor: null, mentorContactPreference: 'in_app' }) },
    actions,
  });
  const turn = await ask.execute({
    partnerId: 'p1',
    message: 'I want to speak to a human about my activation.',
  });
  assert.equal(turn.actions.length, 1);
  assert.equal(turn.actions[0].type, 'request_handoff');
  assert.equal(turn.actions[0].payload.target, 'support');
  assert.equal(actions.created.length, 1);
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
  assert.equal(out.actions[0].type, 'open_page');
  assert.equal(created.length, 0);
});

test('chat responses carry the per-partner daily usage budget', async () => {
  const usecase = askWithLimit(25);
  const now = new Date('2026-11-07T10:00:00Z');

  const first = await usecase.execute({ partnerId: 'p1', message: 'Hello Ora', now });

  assert.equal(first.usage.limit, 25);
  assert.equal(first.usage.used, 1);
  assert.equal(first.usage.remaining, 24);
  assert.equal(first.usage.dateKey, '2026-11-07');
  assert.ok(new Date(first.usage.resetsAt).getTime() > now.getTime());
  assert.deepEqual(await usecase.usageFor('p1', now), first.usage);
  assert.equal((await usecase.usageFor('p2', now)).used, 0);
  assert.equal((await usecase.usageFor('p2', now)).remaining, 25);
});

test('the daily cap rejects the next message with usage details', async () => {
  const usecase = askWithLimit(1);
  const now = new Date('2026-11-07T10:00:00Z');

  await usecase.execute({ partnerId: 'p1', message: 'First message', now });

  await assert.rejects(
    usecase.execute({ partnerId: 'p1', message: 'Second message', now }),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.equal(error.code, 'ORA_RATE_LIMITED');
      assert.equal(error.details.usage.limit, 1);
      assert.equal(error.details.usage.used, 1);
      assert.equal(error.details.usage.remaining, 0);
      return true;
    },
  );
});

test('usage persists across page reloads and new use case instances', async () => {
  const store = new InMemoryOraUsageStore();
  const now = new Date('2026-11-07T10:00:00Z');

  const first = askWithStore(store);
  const out = await first.execute({ partnerId: 'p1', message: 'Hello Ora', now });
  assert.equal(out.usage.used, 1);

  const reloaded = askWithStore(store);
  const usage = await reloaded.usageFor('p1', now);
  assert.equal(usage.used, 1);
  assert.equal(usage.remaining, 24);
});

test('usage expires after the 24-hour window', async () => {
  const store = new InMemoryOraUsageStore();
  const now = new Date('2026-11-07T10:00:00Z');
  const later = new Date(now.getTime() + (24 * 60 * 60 * 1000) + 1);

  const first = askWithStore(store);
  await first.execute({ partnerId: 'p1', message: 'Hello Ora', now });
  assert.equal((await first.usageFor('p1', later)).used, 0);

  const second = askWithStore(store);
  const out = await second.execute({ partnerId: 'p1', message: 'Hello again', now: later });
  assert.equal(out.usage.used, 1);
});

test('a failed model call does not consume a message', async () => {
  const store = new InMemoryOraUsageStore();
  const now = new Date('2026-11-07T10:00:00Z');
  const usecase = new AskOraUseCase({
    conversations: fakeConversations(),
    client: { complete: async () => { throw new Error('provider down'); } },
    context: { assemble: async () => snapshot },
    usageStore: store,
  });

  await assert.rejects(
    usecase.execute({ partnerId: 'p1', message: 'Hello Ora', now }),
    /provider down/,
  );
  assert.equal((await usecase.usageFor('p1', now)).used, 0);
});

test('approval claims once, executes once and returns the existing result afterwards', async () => {
  const state = { status: 'proposed', executions: 0 };
  const stored = {
    id: 'a1', type: 'advance_stage', opportunityId: 'opp:1',
    payload: { prospectId: '507f1f77bcf86cd799439011', stage: 'Interested' },
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
        ? { ...stored, status: 'executed', result: { type: 'advance_stage', stage: 'Interested' } }
        : { ...stored, status: state.status };
    },
    async markExecuted(_id, result) {
      state.status = 'executed';
      return { ...stored, status: 'executed', result };
    },
    async markFailed() { state.status = 'failed'; return {}; },
  };
  const executor = {
    async execute() { state.executions += 1; return { type: 'advance_stage', stage: 'Interested' }; },
  };
  const approve = new ApproveOraActionUseCase({ actions, executor });

  const first = await approve.execute({ partnerId: 'p1', actionId: 'a1' });
  assert.equal(first.status, 'executed');
  assert.equal(state.executions, 1);

  const second = await approve.execute({ partnerId: 'p1', actionId: 'a1' });
  assert.equal(second.status, 'executed');
  assert.equal(state.executions, 1);
});
