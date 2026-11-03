import test from 'node:test';
import assert from 'node:assert/strict';
import { SetPartnerPermissionsUseCase } from './Admin.usecase.js';
import { PERMISSIONS } from '../domain/Permissions.js';

test('sets only validated feature permissions on a partner', async () => {
  const updates = [];
  const partners = {
    async findById() {
      return { _id: 'p1', role: 'user', permissions: [] };
    },
    async updateById(id, patch) {
      updates.push({ id, patch });
      return { _id: id, role: 'user', ...patch };
    },
  };

  const result = await new SetPartnerPermissionsUseCase({ partners }).execute({
    partnerId: 'p1',
    permissions: [PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW, 'unknown.permission'],
  });

  assert.deepEqual(updates, [
    {
      id: 'p1',
      patch: { permissions: [PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW] },
    },
  ]);
  assert.deepEqual(result.permissions, [PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW]);
  assert.equal(result.role, 'user');
});
