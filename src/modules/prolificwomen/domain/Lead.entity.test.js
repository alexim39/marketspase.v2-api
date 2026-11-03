import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeadEntity } from './Lead.entity.js';

const base = {
  name: 'Amaka Okafor',
  phone: '0803 123 4567',
  location: 'Ikeja, Lagos',
  readyToBeMentored: 'yes',
  headOfficeInvite: 'yes',
  availability: 'weekdays',
  submittedAt: '2026-10-29T08:00:00.000Z',
};

test('creates a normalized lead entity', () => {
  const entity = createLeadEntity({ ...base, phone: '+234 803-123-4567' });
  assert.equal(entity.phone, '+2348031234567');
  assert.equal(entity.name, 'Amaka Okafor');
  assert.equal(entity.location, 'Ikeja, Lagos');
  assert.equal(entity.source, 'prolificwoman-web');
  assert.equal(entity.submittedAt.toISOString(), '2026-10-29T08:00:00.000Z');
});

test('rejects invalid phone numbers', () => {
  assert.throws(() => createLeadEntity({ ...base, phone: '12345' }), /Invalid phone/);
});

test('rejects values outside the form contract', () => {
  assert.throws(
    () => createLeadEntity({ ...base, readyToBeMentored: 'maybe' }),
    /Invalid readyToBeMentored/,
  );
  assert.throws(
    () => createLeadEntity({ ...base, availability: 'anytime' }),
    /Invalid availability/,
  );
  assert.throws(
    () => createLeadEntity({ ...base, headOfficeInvite: 'later' }),
    /Invalid headOfficeInvite/,
  );
});

test('rejects invalid submittedAt values', () => {
  assert.throws(
    () => createLeadEntity({ ...base, submittedAt: 'not-a-date' }),
    /Invalid submittedAt/,
  );
});
