import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ListTicketsUseCase, DecideTicketUseCase, TICKET_STATUSES } from './Ticket.inbox.usecase.js';

const ticket = (over = {}) => ({
  id: 't1', subject: 'Login broken', description: 'Cannot sign in', category: 'access',
  priority: 'high', partnerId: 'p1', status: 'open',
  assigneeId: null, resolutionNote: null, resolvedAt: null, ...over,
});

const fakeTickets = (rows = []) => {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  return {
    byId,
    findById: async (id) => byId.has(String(id)) ? { ...byId.get(String(id)) } : null,
    list: async (q) => ({ items: [...byId.values()], total: byId.size, limit: q.limit ?? 25, skip: q.skip ?? 0, echo: q }),
    updateDecision: async (id, patch) => {
      const row = byId.get(String(id));
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
  };
};

describe('TICKET_STATUSES', () => {
  it('covers the inbox lifecycle', () => {
    assert.deepEqual([...TICKET_STATUSES], ['open', 'in-progress', 'resolved', 'closed']);
  });
});

describe('ListTicketsUseCase', () => {
  it('passes filters through', async () => {
    const tickets = fakeTickets([ticket()]);
    const uc = new ListTicketsUseCase({ tickets });
    const res = await uc.execute({ status: 'open', q: 'login', limit: 10, skip: 0 });
    assert.equal(res.total, 1);
    assert.equal(res.echo.status, 'open');
  });

  it('rejects unknown statuses', async () => {
    const uc = new ListTicketsUseCase({ tickets: fakeTickets([]) });
    await assert.rejects(uc.execute({ status: 'nope' }), /Unknown ticket status/);
  });

  it('attaches reporter labels in one batched lookup', async () => {
    const uc = new ListTicketsUseCase({
      tickets: fakeTickets([ticket()]),
      partners: {
        findLabelsByIds: async (ids) => ids.map((id) => ({ id: String(id), username: 'member', name: 'Mem Ber' })),
      },
    });
    const res = await uc.execute({});
    assert.equal(res.items[0].reporter?.username, 'member');
    assert.equal(res.items[0].reporter?.name, 'Mem Ber');
  });

  it('degrades to null reporters when labels fail', async () => {
    const uc = new ListTicketsUseCase({
      tickets: fakeTickets([ticket()]),
      partners: { findLabelsByIds: async () => { throw new Error('db down'); } },
    });
    const res = await uc.execute({});
    assert.equal(res.total, 1);
    assert.ok(!('reporter' in res.items[0]) || res.items[0].reporter == null);
  });
});

describe('DecideTicketUseCase', () => {
  it('assigns and moves open tickets forward', async () => {
    const tickets = fakeTickets([ticket()]);
    const uc = new DecideTicketUseCase({ tickets });
    const { previous, ticket: next } = await uc.execute({
      ticketId: 't1', status: 'in-progress', assigneeId: 'admin1',
    });
    assert.equal(previous.status, 'open');
    assert.equal(next.status, 'in-progress');
    assert.equal(next.assigneeId, 'admin1');
  });

  it('stamps resolvedAt on resolve', async () => {
    const tickets = fakeTickets([ticket({ status: 'in-progress' })]);
    const uc = new DecideTicketUseCase({ tickets });
    const { ticket: next } = await uc.execute({ ticketId: 't1', status: 'resolved', note: 'Fixed in v2' });
    assert.equal(next.status, 'resolved');
    assert.equal(next.resolutionNote, 'Fixed in v2');
    assert.ok(next.resolvedAt);
  });

  it('keeps closed terminal without explicit reopen', async () => {
    const tickets = fakeTickets([ticket({ status: 'closed' })]);
    const uc = new DecideTicketUseCase({ tickets });
    await assert.rejects(uc.execute({ ticketId: 't1', status: 'open' }), /reopen/);
    const { ticket: next } = await uc.execute({ ticketId: 't1', status: 'in-progress', reopen: true });
    assert.equal(next.status, 'in-progress');
  });

  it('rejects empty updates and unknown tickets', async () => {
    const tickets = fakeTickets([ticket()]);
    const uc = new DecideTicketUseCase({ tickets });
    await assert.rejects(uc.execute({ ticketId: 't1' }), /Nothing to update/);
    await assert.rejects(uc.execute({ ticketId: 'ghost', status: 'closed' }), /not found/i);
  });

  it('rejects unknown statuses', async () => {
    const uc = new DecideTicketUseCase({ tickets: fakeTickets([ticket()]) });
    await assert.rejects(uc.execute({ ticketId: 't1', status: 'nope' }), /Unknown ticket status/);
  });
});
