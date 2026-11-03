import test from 'node:test';
import assert from 'node:assert/strict';
import { SubmitLeadUseCase } from './SubmitLead.usecase.js';

test('persists a normalized lead through the repository', async () => {
  const saved = [];
  const leads = {
    async save(entity) {
      saved.push(entity);
      return { ...entity, id: 'lead-1', createdAt: new Date('2026-10-29T08:01:00.000Z') };
    },
  };

  const result = await new SubmitLeadUseCase({ leads }).execute({
    name: ' Amaka Okafor ',
    phone: '0803-123-4567',
    location: ' Ikeja, Lagos ',
    readyToBeMentored: 'yes',
    headOfficeInvite: 'no',
    availability: 'weekends',
    submittedAt: '2026-10-29T08:00:00.000Z',
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].phone, '08031234567');
  assert.equal(result.id, 'lead-1');
  assert.equal(result.phone, '08031234567');
});
