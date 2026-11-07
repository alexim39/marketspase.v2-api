import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOraOpportunities } from './Ora.opportunities.js';

const prospect = (over = {}) => ({
  id: 'p1',
  prospectName: 'Paul',
  prospectSurname: 'Obi',
  prospectPhone: '08030000000',
  prospectEmail: 'paul@example.com',
  consentToContact: true,
  status: { stage: 'Contacted', name: 'Contacted' },
  communications: [{
    status: 'Open',
    type: 'call',
    date: new Date(Date.now() - 5 * 86400000).toISOString(),
    followUpDate: new Date(Date.now() - 2 * 86400000).toISOString(),
    outcome: 'Follow-up set',
  }],
  ...over,
});

const input = (over = {}) => ({
  prospects: { items: [prospect()], total: 1 },
  goals: [],
  events: { items: [] },
  unread: 0,
  partner: { commissionRank: 'Partner', balance: 5000 },
  now: new Date(),
  ...over,
});

test('a stale consenting prospect becomes an approvable SMS opportunity', () => {
  const rows = buildOraOpportunities(input());
  const row = rows.find((o) => o.type === 'send_sms');
  assert.ok(row);
  assert.equal(row.prospectId, 'p1');
  assert.equal(row.requiresApproval, true);
  assert.equal(row.capabilityKey, 'pipeline.followups');
  assert.match(row.payload.body, /Paul/);
});

test('no recorded consent falls back to a review page, never an automated send', () => {
  const rows = buildOraOpportunities(input({
    prospects: { items: [prospect({ consentToContact: false })], total: 1 },
  }));
  const row = rows.find((o) => o.prospectId === 'p1');
  assert.equal(row.type, 'open_page');
  assert.match(row.reason, /consent not recorded/i);
});

test('survey and admin-pushed leads are opt-in even on legacy rows', () => {
  const rows = buildOraOpportunities(input({
    prospects: {
      items: [prospect({ consentToContact: false, prospectSource: 'Website' })],
      total: 1,
    },
  }));
  assert.equal(rows.find((o) => o.prospectId === 'p1').type, 'send_sms');
});

test('at-risk goals, unread notifications and the next event are captured', () => {
  const rows = buildOraOpportunities(input({
    goals: [{ id: 'g1', title: 'Recruit 5', progress: { percent: 20, onTrack: false, complete: false, daysLeft: 3 } }],
    unread: 4,
    events: { items: [{ id: 'e1', title: 'Team call', startsAt: new Date().toISOString() }] },
  }));
  assert.ok(rows.some((o) => o.capabilityKey === 'learn.goals'));
  assert.ok(rows.some((o) => o.capabilityKey === 'notifications.center'));
  assert.ok(rows.some((o) => o.capabilityKey === 'community.events'));
});
