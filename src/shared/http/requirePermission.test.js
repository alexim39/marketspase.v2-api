import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePermission } from './requirePermission.js';
import { PartnersModel } from '../../apps/partner/models/partner.model.js';
import { PERMISSIONS } from '../../modules/identity-access/domain/Permissions.js';

const withPartner = (doc) => {
  const original = PartnersModel.findById;
  PartnersModel.findById = () => ({
    select: () => ({
      lean: () => Promise.resolve(doc),
    }),
  });
  return () => {
    PartnersModel.findById = original;
  };
};

const run = (req) =>
  new Promise((resolve) => {
    requirePermission(PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW)(req, {}, resolve);
  });

test('allows a user explicitly granted the capability', async () => {
  const restore = withPartner({
    permissions: [PERMISSIONS.PROLIFIC_WOMAN_LEADS_VIEW],
  });
  try {
    const error = await run({ auth: { partnerId: 'p1' } });
    assert.equal(error, undefined);
  } finally {
    restore();
  }
});

test('does not treat admin role as an implicit capability', async () => {
  const restore = withPartner({ role: 'admin', permissions: [] });
  try {
    const error = await run({ auth: { partnerId: 'p1' } });
    assert.equal(error?.statusCode, 403);
    assert.equal(error?.code, 'FORBIDDEN');
  } finally {
    restore();
  }
});

test('rejects unauthenticated requests', async () => {
  const error = await run({ auth: {} });
  assert.equal(error?.statusCode, 401);
});
