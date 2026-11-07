import test from 'node:test';
import assert from 'node:assert/strict';
import { ORA_ACTION_TYPES, ORA_CAPABILITIES, capabilityByKey } from './Ora.capabilities.js';

test('every Ora capability has a unique key, a dashboard page and valid actions', () => {
  const keys = new Set();
  for (const item of ORA_CAPABILITIES) {
    assert.ok(item.key && !keys.has(item.key), `duplicate key: ${item.key}`);
    keys.add(item.key);
    assert.match(item.page, /^\/dashboard(?:\/|$)/, item.key);
    assert.ok(item.area, item.key);
    assert.ok(item.title, item.key);
    for (const action of item.actions) {
      assert.ok(ORA_ACTION_TYPES.includes(action), `${item.key}: ${action}`);
    }
  }
  assert.ok(keys.has('pipeline.followups'));
  assert.ok(keys.has('team.activation'));
  assert.ok(keys.has('learn.goals'));
  assert.ok(keys.has('wallet.compensation'));
  assert.ok(keys.has('products.store-orders'));
});

test('capability lookup is exact', () => {
  assert.equal(capabilityByKey('pipeline.followups')?.page, '/dashboard/prospects/pipeline');
  assert.equal(capabilityByKey('missing'), null);
  assert.equal(capabilityByKey(''), null);
});
