import test from 'node:test';
import assert from 'node:assert/strict';

// Regression: the legacy status-less `Ticket` model must never shadow the
// slice model — otherwise strict mode strips status writes and every row
// reads back as 'open' with zero errors anywhere.
test('ticket slice model carries the workflow paths on the shared collection', async () => {
  await import('../../../apps/ticket/models/ticket.model.js');
  const { TicketMongooseModel } = await import('./Ticket.schema.js');
  for (const path of ['status', 'assigneeId', 'resolutionNote', 'resolvedAt']) {
    assert.ok(TicketMongooseModel.schema.path(path), `missing schema path: ${path}`);
  }
  assert.equal(TicketMongooseModel.collection.name, 'tickets');
});
