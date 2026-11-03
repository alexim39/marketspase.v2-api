import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, normalizePermissions, hasPermission } from './Permissions.js';

test('normalizes known permissions and drops unknown values', () => {
  assert.deepEqual(
    normalizePermissions([
      PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW,
      'unknown.permission',
      PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW,
      null,
    ]),
    [PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW],
  );
});

test('checks permission grants without an admin bypass', () => {
  assert.equal(
    hasPermission(
      { permissions: [PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW] },
      PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW,
    ),
    true,
  );
  assert.equal(
    hasPermission({ role: 'admin', permissions: [] }, PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW),
    false,
  );
  assert.equal(hasPermission({}, PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW), false);
});
