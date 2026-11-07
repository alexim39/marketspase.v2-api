import test from 'node:test';
import assert from 'node:assert/strict';

// Regression: the v1 ticket model must keep the workflow paths on the shared
// historical 'tickets' collection.
test('ticket slice model carries the workflow paths on the shared collection', async () => {
  const { TicketMongooseModel } = await import('./Ticket.schema.js');
  for (const path of ['status', 'assigneeId', 'resolutionNote', 'resolvedAt']) {
    assert.ok(TicketMongooseModel.schema.path(path), `missing schema path: ${path}`);
  }
  assert.equal(TicketMongooseModel.collection.name, 'tickets');
});
