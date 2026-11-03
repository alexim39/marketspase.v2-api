import test from 'node:test';
import assert from 'node:assert/strict';
import { InboxLeadsQuery, SubmitLeadSchema } from './Lead.validator.js';

const valid = {
  name: 'Amaka Okafor',
  phone: '08031234567',
  location: 'Ikeja, Lagos',
  readyToBeMentored: 'yes',
  headOfficeInvite: 'yes',
  availability: 'weekdays',
  submittedAt: '2026-10-29T08:00:00.000Z',
};

test('accepts a valid form payload and strips unknown keys', () => {
  const parsed = SubmitLeadSchema.parse({ ...valid, admin: true });
  assert.equal(parsed.name, 'Amaka Okafor');
  assert.equal(parsed.readyToBeMentored, 'yes');
  assert.equal('admin' in parsed, false);
});

test('rejects invalid enums and missing fields', () => {
  assert.throws(() => SubmitLeadSchema.parse({ ...valid, readyToBeMentored: 'maybe' }));
  assert.throws(() => SubmitLeadSchema.parse({ ...valid, availability: undefined }));
  assert.throws(() => SubmitLeadSchema.parse({ ...valid, phone: '123' }));
});

test('inbox query supports the page size used by the Prospect inbox', () => {
  const parsed = InboxLeadsQuery.parse({ limit: '500' });
  assert.equal(parsed.limit, 500);
});
