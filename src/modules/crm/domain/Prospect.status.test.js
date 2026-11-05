import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStatusOverlay,
  stageForStatusName,
  statusNameForStage,
} from './Prospect.entity.js';

test('coaching status names map to canonical pipeline stages', () => {
  assert.equal(stageForStatusName('New Prospect'), 'New');
  assert.equal(stageForStatusName('Follow-Up Scheduled'), 'Contacted');
  assert.equal(stageForStatusName('Booked for Session'), 'In Negotiation');
  assert.equal(stageForStatusName('Partner'), 'Converted');
  assert.equal(stageForStatusName('Disqualified'), 'Closed');
  assert.equal(stageForStatusName('unknown custom text'), null);
});

test('canonical stages map back to a coaching label', () => {
  assert.equal(statusNameForStage('New'), 'New Prospect');
  assert.equal(statusNameForStage('In Negotiation'), 'Closing');
  assert.equal(statusNameForStage('Converted'), 'Partner');
  assert.equal(statusNameForStage('Closed'), 'Not Interested');
});

test('a coaching status update writes the canonical stage too', () => {
  const overlay = createStatusOverlay({ name: 'Booked for Session' });
  assert.equal(overlay.name, 'Booked for Session');
  assert.equal(overlay.stage, 'In Negotiation');
  assert.ok(overlay.stageEnteredAt instanceof Date);
});

test('an explicit stage wins when both are supplied', () => {
  const overlay = createStatusOverlay({ name: 'Interested', stage: 'In Negotiation' });
  assert.equal(overlay.name, 'Interested');
  assert.equal(overlay.stage, 'In Negotiation');
});

test('an unknown coaching status leaves the pipeline stage alone', () => {
  const overlay = createStatusOverlay({ name: 'Call back Tuesday' });
  assert.equal(overlay.name, 'Call back Tuesday');
  assert.equal(overlay.stage, undefined);
});
