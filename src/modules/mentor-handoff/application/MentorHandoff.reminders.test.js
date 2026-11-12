import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MentorHandoffReminderUseCase } from './MentorHandoff.reminders.js';

const mentorId = 'a'.repeat(24);
const mentorId2 = 'b'.repeat(24);
const memberId = 'c'.repeat(24);
const uplineId = 'd'.repeat(24);
const adminId = 'e'.repeat(24);
const handoffId = 'f'.repeat(24);

const NOW = new Date('2026-11-12T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const mentor = {
  _id: mentorId,
  name: 'Ada',
  surname: 'Obi',
  username: 'ada',
  email: 'ada@example.com',
  phone: '08030000001',
  partnerOf: uplineId,
};

const member = {
  _id: memberId,
  name: 'Bola',
  surname: 'Ade',
  username: 'bola',
  accountState: 'member',
  activatedAt: null,
};

const makeTask = (overrides = {}) => ({
  _id: handoffId,
  partnerId: memberId,
  mentorId,
  preference: 'in_app',
  joinedAt: new Date(NOW.getTime() - (25 * HOUR)),
  firstContactAt: null,
  reminder24At: null,
  reminder48At: null,
  day7At: null,
  escalatedAt: null,
  ...overrides,
});

const makePartners = ({
  memberRow = member,
  mentorRow = mentor,
  admins = [{ _id: adminId }],
  upline = { _id: uplineId, name: 'Ngozi', surname: 'Eze', email: 'ngozi@example.com' },
} = {}) => {
  const rows = new Map([
    [memberId, memberRow],
    [mentorId, mentorRow],
    [mentorId2, { ...mentor, _id: mentorId2, partnerOf: null }],
    [uplineId, upline],
    [adminId, { _id: adminId, name: 'Admin', email: 'admin@example.com' }],
  ]);
  return {
    findById: async (id) => rows.get(String(id)) ?? null,
    find: () => {
      const chain = {
        select: () => chain,
        limit: () => chain,
        lean: async () => admins,
      };
      return chain;
    },
  };
};

const makeHandoffs = (tasks) => {
  const marks = [];
  return {
    marks,
    listReminderCandidates: async () => tasks,
    markReminder: async (id, field, at) => {
      marks.push({ id, field, at });
      return { _id: id };
    },
  };
};

const makeDelivery = () => {
  const calls = [];
  return {
    calls,
    deliver: async (input) => {
      calls.push(input);
      return { inApp: 'created', email: true, sms: false, push: 0, pruned: 0, errors: [] };
    },
  };
};

describe('MentorHandoffReminderUseCase', () => {
  it('sends the 24-hour welcome reminder to the mentor', async () => {
    const handoffs = makeHandoffs([makeTask()]);
    const delivery = makeDelivery();
    const useCase = new MentorHandoffReminderUseCase({
      handoffs,
      delivery,
      partners: makePartners(),
    });

    const result = await useCase.run(NOW);

    assert.equal(result.reminders, 1);
    assert.equal(result.escalated, 0);
    assert.equal(delivery.calls.length, 1);
    const call = delivery.calls[0];
    assert.equal(call.recipientId, mentorId);
    assert.equal(call.item.link, '/dashboard/team/handoffs');
    assert.equal(call.item.priority, 'medium');
    assert.match(call.item.title, /24-hour/);
    assert.match(call.item.body, /welcome message/i);
    assert.equal(call.emailPolicy, 'force');
    assert.deepEqual(handoffs.marks, [{ id: handoffId, field: 'reminder24At', at: NOW }]);
  });

  it('sends the 48-hour reminder and calls out missing contact', async () => {
    const handoffs = makeHandoffs([makeTask({
      joinedAt: new Date(NOW.getTime() - (49 * HOUR)),
      reminder24At: new Date(NOW.getTime() - DAY),
    })]);
    const delivery = makeDelivery();
    const useCase = new MentorHandoffReminderUseCase({
      handoffs,
      delivery,
      partners: makePartners(),
    });

    const result = await useCase.run(NOW);

    assert.equal(result.reminders, 1);
    assert.match(delivery.calls[0].item.title, /48-hour/);
    assert.match(delivery.calls[0].item.body, /not been contacted/);
    assert.equal(handoffs.marks[0].field, 'reminder48At');
  });

  it('runs the day-7 training check for a contacted member', async () => {
    const handoffs = makeHandoffs([makeTask({
      joinedAt: new Date(NOW.getTime() - (8 * DAY)),
      firstContactAt: new Date(NOW.getTime() - (6 * DAY)),
      reminder24At: new Date(NOW.getTime() - (7 * DAY)),
      reminder48At: new Date(NOW.getTime() - (6 * DAY)),
    })]);
    const delivery = makeDelivery();
    const useCase = new MentorHandoffReminderUseCase({
      handoffs,
      delivery,
      partners: makePartners({
        memberRow: { ...member, accountState: 'partner', activatedAt: new Date(NOW.getTime() - (5 * DAY)) },
      }),
    });

    const result = await useCase.run(NOW);

    assert.equal(result.reminders, 1);
    assert.equal(result.escalated, 0);
    assert.match(delivery.calls[0].item.body, /training progress/);
    assert.equal(delivery.calls[0].item.priority, 'high');
    assert.equal(handoffs.marks[0].field, 'day7At');
  });

  it('escalates a still-uncontacted member to the upline and admins', async () => {
    const handoffs = makeHandoffs([makeTask({
      joinedAt: new Date(NOW.getTime() - (8 * DAY)),
    })]);
    const delivery = makeDelivery();
    const useCase = new MentorHandoffReminderUseCase({
      handoffs,
      delivery,
      partners: makePartners(),
    });

    const result = await useCase.run(NOW);

    assert.equal(result.reminders, 1);
    assert.equal(result.escalated, 1);
    assert.equal(delivery.calls.length, 3);

    const mentorCall = delivery.calls[0];
    assert.equal(mentorCall.recipientId, mentorId);
    assert.match(mentorCall.item.body, /has not activated yet/);

    const recipients = delivery.calls.slice(1).map((call) => call.recipientId).sort();
    assert.deepEqual(recipients, [uplineId, adminId].sort());
    assert.ok(delivery.calls.slice(1).every((call) => /Escalation:/.test(call.item.title)));
    assert.ok(delivery.calls.slice(1).every((call) => /no recorded contact after 7 days/.test(call.item.body)));

    assert.ok(handoffs.marks.some((mark) => mark.field === 'escalatedAt'));
    assert.ok(handoffs.marks.some((mark) => mark.field === 'day7At'));
  });

  it('stamps missed earlier reminders so an overdue task cannot burst', async () => {
    const handoffs = makeHandoffs([makeTask({
      joinedAt: new Date(NOW.getTime() - (10 * DAY)),
    })]);
    const delivery = makeDelivery();
    const useCase = new MentorHandoffReminderUseCase({
      handoffs,
      delivery,
      partners: makePartners({ mentorRow: { ...mentor, partnerOf: null }, admins: [] }),
    });

    await useCase.run(NOW);

    const fields = handoffs.marks.map((mark) => mark.field);
    assert.deepEqual(fields, ['day7At', 'reminder24At', 'reminder48At']);
    assert.equal(delivery.calls.length, 1, 'only one reminder message per run');
  });

  it('respects prefer-not-now without delivering anything', async () => {
    const handoffs = makeHandoffs([makeTask({
      preference: 'prefer_not_now',
      joinedAt: new Date(NOW.getTime() - (8 * DAY)),
    })]);
    const delivery = makeDelivery();
    const useCase = new MentorHandoffReminderUseCase({
      handoffs,
      delivery,
      partners: makePartners(),
    });

    const result = await useCase.run(NOW);

    assert.equal(result.skipped, 1);
    assert.equal(result.reminders, 0);
    assert.equal(delivery.calls.length, 0);
    assert.equal(handoffs.marks.length, 0);
  });

  it('skips tasks that already had every reminder', async () => {
    const handoffs = makeHandoffs([makeTask({
      joinedAt: new Date(NOW.getTime() - (8 * DAY)),
      reminder24At: new Date(),
      reminder48At: new Date(),
      day7At: new Date(),
      escalatedAt: new Date(),
    })]);
    const delivery = makeDelivery();
    const useCase = new MentorHandoffReminderUseCase({
      handoffs,
      delivery,
      partners: makePartners(),
    });

    const result = await useCase.run(NOW);

    assert.equal(result.skipped, 1);
    assert.equal(delivery.calls.length, 0);
  });

  it('counts a delivery failure without marking the reminder done', async () => {
    const handoffs = makeHandoffs([makeTask()]);
    const useCase = new MentorHandoffReminderUseCase({
      handoffs,
      delivery: { deliver: async () => { throw new Error('mail down'); } },
      partners: makePartners(),
    });

    const result = await useCase.run(NOW);

    assert.equal(result.failed, 1);
    assert.equal(result.reminders, 0);
    assert.equal(handoffs.marks.length, 0);
  });

  it('does not stamp a reminder when every channel is unavailable', async () => {
    const handoffs = makeHandoffs([makeTask()]);
    const useCase = new MentorHandoffReminderUseCase({
      handoffs,
      delivery: {
        deliver: async () => ({ inApp: 'muted', email: false, sms: false, push: 0, errors: [] }),
      },
      partners: makePartners(),
    });

    const result = await useCase.run(NOW);

    assert.equal(result.failed, 1);
    assert.equal(result.reminders, 0);
    assert.equal(handoffs.marks.length, 0);
  });
});
