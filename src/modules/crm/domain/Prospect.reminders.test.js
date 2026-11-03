import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketFollowUps } from './Prospect.reminders.js';
import { buildProspectNotifications } from './Prospect.notifications.js';

const NOW = new Date('2026-10-07T12:00:00Z');
const iso = (s) => new Date(s).toISOString();
const row = (over = {}) => ({
  id: 'p1',
  prospectName: 'Ada',
  prospectSurname: 'T',
  status: { stage: 'Interested' },
  communications: [{ status: 'Open', outcome: 'Follow-up set', followUpDate: iso('2026-10-07T09:00:00Z'), date: iso('2026-10-06T09:00:00Z') }],
  ...over,
});

test('bucketFollowUps splits overdue / today / upcoming from the latest touch', () => {
  const items = [
    row({ id: 'o', communications: [{ status: 'Open', followUpDate: iso('2026-10-05T09:00:00Z') }] }),
    row({ id: 't' }),
    row({ id: 'u', communications: [{ status: 'Open', followUpDate: iso('2026-10-10T09:00:00Z') }] }),
  ];
  const b = bucketFollowUps(items, NOW);
  assert.deepEqual(b.overdue.map((e) => e.prospectId), ['o']);
  assert.equal(b.overdue[0].daysOverdue, 2);
  assert.deepEqual(b.today.map((e) => e.prospectId), ['t']);
  assert.deepEqual(b.upcoming.map((e) => e.prospectId), ['u']);
});

test('bucketFollowUps skips terminal stages, Closed-lost and dateless touches', () => {
  const items = [
    row({ id: 'conv', status: { stage: 'Converted' } }),
    row({ id: 'lost', communications: [{ status: 'Open', outcome: 'Closed-lost', followUpDate: iso('2026-10-07T09:00:00Z') }] }),
    row({ id: 'none', communications: [{ status: 'Open', description: 'hi' }] }),
  ];
  const b = bucketFollowUps(items, NOW);
  assert.equal(b.overdue.length + b.today.length + b.upcoming.length, 0);
});

test('fresh touch without a date clears the reminder', () => {
  const items = [row({
    id: 'cleared',
    communications: [
      { status: 'Open', followUpDate: iso('2026-10-05T09:00:00Z') },
      { status: 'Open', description: 'called back' },
    ],
  })];
  const b = bucketFollowUps(items, NOW);
  assert.equal(b.overdue.length + b.today.length + b.upcoming.length, 0);
});

test('notifications builder flags overdue and due-today callbacks', () => {
  const notes = buildProspectNotifications([
    row({ id: 'o', prospectName: 'Obi', communications: [{ status: 'Open', type: 'call', followUpDate: iso('2026-10-05T09:00:00Z') }] }),
    row({ id: 't', prospectName: 'Tessy' }),
  ], NOW);
  const tags = notes.map((n) => n.tag);
  assert.ok(tags.includes('Follow-up overdue'));
  assert.ok(tags.includes('Follow-up due'));
});

test('presentation touches feed reminders and notifications like any touch', () => {
  const items = [
    row({
      id: 'deck',
      communications: [{
        status: 'Open', type: 'presentation', outcome: 'Follow-up set',
        followUpDate: iso('2026-10-09T09:00:00Z'), date: iso('2026-10-06T09:00:00Z'),
      }],
    }),
  ];
  const b = bucketFollowUps(items, NOW);
  assert.deepEqual(b.upcoming.map((e) => e.prospectId), ['deck']);
  const notes = buildProspectNotifications(items, NOW);
  assert.ok(notes.length > 0);
});
