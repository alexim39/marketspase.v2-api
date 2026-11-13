import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordMentorCheckinUseCase } from './MentorPlaybook.usecases.js';

const memberId = '507f1f77bcf86cd799439012';
const mentorId = '507f1f77bcf86cd799439011';

test('records a check-in for a real downline member', async () => {
  const calls = [];
  const usecase = new RecordMentorCheckinUseCase({
    network: {
      findChildren: async (ids) => (ids.includes(mentorId) ? [{ id: memberId }] : []),
    },
    checkins: { create: async (input) => { calls.push(input); return { id: 'c1', ...input }; } },
    audit: async () => ({}),
  });
  const out = await usecase.execute({ mentorId, memberId, kind: 'day3', note: 'Discussed IPO' });
  assert.equal(out.kind, 'day3');
  assert.equal(calls[0].mentorId, mentorId);
  assert.equal(calls[0].memberId, memberId);
});

test('rejects a check-in for a member outside the downline', async () => {
  const usecase = new RecordMentorCheckinUseCase({
    network: { findChildren: async () => [] },
    checkins: { create: async () => ({}) },
    audit: async () => ({}),
  });
  await assert.rejects(usecase.execute({ mentorId, memberId }), /not in your downline/i);
});
