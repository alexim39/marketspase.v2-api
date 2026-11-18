import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminOraService } from './AdminOra.service.js';

const CID = '507f1f77bcf86cd799439011';
const PID = '507f1f77bcf86cd799439012';

const query = (rows) => ({
  select: () => query(rows),
  sort: () => query(rows),
  limit: (n) => query(rows.slice(0, n)),
  lean: async () => rows.map((row) => ({ ...row })),
});

const fakeConversations = () => {
  const row = {
    _id: CID,
    partnerId: PID,
    title: 'Getting started',
    messages: [
      { role: 'user', content: 'How do I start?', at: new Date('2026-11-18T00:00:00Z') },
      { role: 'assistant', content: 'Start with the IPO course.', at: new Date('2026-11-18T00:00:01Z') },
    ],
    pinned: false,
    moderation: { flagged: false, hidden: false, notes: [] },
    createdAt: new Date('2026-11-18T00:00:00Z'),
    updatedAt: new Date('2026-11-18T00:00:01Z'),
  };
  return {
    row,
    aggregate: async (pipeline) => {
      const group = pipeline.find((stage) => stage.$group)?.$group;
      if (group?.conversations) {
        return [{ conversations: 1, messages: 2, flagged: 0, hidden: 0 }];
      }
      if (pipeline.some((stage) => stage.$count)) return [{ total: 1 }];
      return [{
        ...row,
        messageCount: row.messages.length,
        lastMessage: row.messages.at(-1),
        partner: { _id: PID, name: 'Ada', surname: 'Obi', username: 'ada', email: 'ada@x.test', accountState: 'member' },
      }];
    },
    distinct: async () => [PID],
    findById: () => ({
      lean: async () => ({ ...row }),
    }),
    findByIdAndUpdate: (id, update) => {
      for (const [key, value] of Object.entries(update.$set ?? {})) {
        if (key.startsWith('moderation.')) row.moderation[key.slice('moderation.'.length)] = value;
        else row[key] = value;
      }
      if (update.$push) {
        for (const [key, value] of Object.entries(update.$push)) {
          if (key === 'moderation.notes') row.moderation.notes.push(value);
        }
      }
      return { lean: async () => ({ ...row }) };
    },
  };
};

const fakeActions = () => ({
  find: () => ({
    sort: () => ({
      limit: () => ({ lean: async () => [{
        _id: '507f1f77bcf86cd799439013', partnerId: PID, conversationId: CID,
        type: 'schedule_followup', title: 'Follow up', status: 'proposed', createdAt: new Date(),
      }] }),
    }),
  }),
  countDocuments: async () => 1,
  aggregate: async () => [{ _id: 'proposed', count: 1 }],
});

const fakeEvents = () => ({
  find: () => ({
    sort: () => ({
      limit: () => ({ lean: async () => [{
        _id: '507f1f77bcf86cd799439014', topic: 'growth', messageChars: 15,
        replyChars: 30, latencyMs: 450, at: new Date('2026-11-18T00:00:01Z'),
      }] }),
    }),
  }),
  aggregate: async (pipeline) => {
    if (pipeline.some((stage) => stage.$group && stage.$group.avgLatencyMs)) {
      return [{ exchanges: 1, avgLatencyMs: 450 }];
    }
    if (pipeline.some((stage) => stage.$group && stage.$group._id === '$topic')) {
      return [{ _id: 'growth', count: 1 }];
    }
    if (pipeline.some((stage) => stage.$group && stage.$group._id?.$dateToString)) {
      return [{ _id: '2026-11-18', count: 1 }];
    }
    return [];
  },
});

const fakePlans = () => ({
  findOne: () => ({
    sort: () => ({ lean: async () => ({ _id: 'plan1', partnerId: PID, dateKey: '2026-11-18', items: [], source: 'partner' }) }),
  }),
});

const fakePartners = () => ({
  findById: () => ({
    select: () => ({ lean: async () => ({ _id: PID, name: 'Ada', surname: 'Obi', username: 'ada', email: 'ada@x.test', accountState: 'member' }) }),
  }),
  find: () => ({ select: () => ({ lean: async () => [] }) }),
});

const service = () => new AdminOraService({
  conversations: fakeConversations(),
  actions: fakeActions(),
  events: fakeEvents(),
  plans: fakePlans(),
  partners: fakePartners(),
});

test('lists conversations with combined filters and pagination', async () => {
  const out = await service().listConversations({
    q: 'start', accountState: 'member', flagged: 'no', hidden: 'no', limit: 10, skip: 0,
  });
  assert.equal(out.total, 1);
  assert.equal(out.items[0].partner.accountState, 'member');
  assert.equal(out.items[0].messageCount, 2);
});

test('returns the full transcript, actions, events and plan', async () => {
  const out = await service().conversation(CID);
  assert.equal(out.conversation.messages.length, 2);
  assert.equal(out.conversation.partner.name, 'Ada Obi');
  assert.equal(out.actions[0].type, 'schedule_followup');
  assert.equal(out.events[0].topic, 'growth');
  assert.equal(out.plan.source, 'partner');
});

test('flags, notes and hides a conversation', async () => {
  const svc = service();
  const flagged = await svc.flag(CID, { flagged: true, reason: 'Review', adminId: null });
  assert.equal(flagged.moderation.flagged, true);
  const noted = await svc.addNote(CID, { note: 'Checked by admin' });
  assert.equal(noted.moderation.notesCount, 1);
  const hidden = await svc.setHidden(CID, { hidden: true, reason: 'Privacy' });
  assert.equal(hidden.moderation.hidden, true);
});

test('overview returns KPI totals from conversations, actions and events', async () => {
  const out = await service().overview({ days: 30 });
  assert.equal(out.conversations, 1);
  assert.equal(out.activeUsers, 1);
  assert.equal(out.exchanges, 1);
  assert.equal(out.avgLatencyMs, 450);
  assert.equal(out.topics[0].topic, 'growth');
});
