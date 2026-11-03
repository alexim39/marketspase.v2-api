import test from 'node:test';
import assert from 'node:assert/strict';
import { DeleteProlificWomanLeadUseCase } from './DeleteProlificWomanLead.usecase.js';

const ID = '6ae2e014c931006d58bdebf4';

const fakeLeads = (row) => ({
  removed: false,
  async findById(id) {
    return String(id) === ID ? { ...row } : null;
  },
  async removeById(id) {
    if (String(id) !== ID) return null;
    this.removed = true;
    return { id: ID };
  },
});

test('deletes an unaccepted lead by id', async () => {
  const leads = fakeLeads({ id: ID, acceptedAt: null });
  const result = await new DeleteProlificWomanLeadUseCase({ leads }).execute({ leadId: ID });
  assert.equal(result.id, ID);
  assert.equal(leads.removed, true);
});

test('rejects an unknown id without touching the store', async () => {
  const leads = fakeLeads(null);
  await assert.rejects(
    new DeleteProlificWomanLeadUseCase({ leads }).execute({ leadId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
    /Lead not found/,
  );
  assert.equal(leads.removed, false);
});

test('rejects malformed ids before any store read', async () => {
  const leads = fakeLeads({ id: ID, acceptedAt: null });
  await assert.rejects(
    new DeleteProlificWomanLeadUseCase({ leads }).execute({ leadId: 'nope' }),
    /Invalid lead id/,
  );
  assert.equal(leads.removed, false);
});

test('refuses accepted leads that already live on as prospects', async () => {
  const leads = fakeLeads({ id: ID, acceptedAt: new Date().toISOString() });
  await assert.rejects(
    new DeleteProlificWomanLeadUseCase({ leads }).execute({ leadId: ID }),
    /already been accepted/,
  );
  assert.equal(leads.removed, false);
});
