import test from 'node:test';
import assert from 'node:assert/strict';

const { RefreshSessions, RefreshSessionModel } = await import('./RefreshSessions.js');

const original = {
  findOne: RefreshSessionModel.findOne,
  findOneAndUpdate: RefreshSessionModel.findOneAndUpdate,
  findById: RefreshSessionModel.findById,
  create: RefreshSessionModel.create,
  updateMany: RefreshSessionModel.updateMany,
};

const restore = () => {
  Object.assign(RefreshSessionModel, original);
};

const lean = (value) => ({ lean: async () => value });

const baseRow = {
  _id: 'row-1',
  partnerId: 'partner-1',
  familyId: 'family-1',
  scope: 'partner',
  revokedAt: null,
  replacedByHash: null,
  expiresAt: new Date(Date.now() + 60_000),
  ip: null,
  userAgent: null,
};

/**
 * Concurrent tab refreshes present the same single-use token. Treating that
 * as theft revokes the replacement the winning tab just received, logging
 * both tabs out — the race must only fail the losing request.
 */
test('a just-rotated refresh token does not revoke the session family', async (t) => {
  t.after(restore);
  let familyRevoked = 0;
  Object.assign(RefreshSessionModel, {
    findOne: () => lean({ ...baseRow, revokedAt: new Date(Date.now() - 1_000) }),
    findOneAndUpdate: () => lean(null),
    findById: () => lean({ ...baseRow, revokedAt: new Date(Date.now() - 1_000) }),
    updateMany: async () => { familyRevoked += 1; return { modifiedCount: 0 }; },
  });

  await assert.rejects(
    () => new RefreshSessions().rotate({ token: 'r'.repeat(48), scope: 'partner' }),
    /just rotated/,
  );
  assert.equal(familyRevoked, 0);
});

test('a stale reused refresh token still revokes the whole family', async (t) => {
  t.after(restore);
  let familyRevoked = 0;
  Object.assign(RefreshSessionModel, {
    findOne: () => lean({ ...baseRow, revokedAt: new Date(Date.now() - 5 * 60_000) }),
    findOneAndUpdate: () => lean(null),
    findById: () => lean({ ...baseRow, revokedAt: new Date(Date.now() - 5 * 60_000) }),
    updateMany: async () => { familyRevoked += 1; return { modifiedCount: 1 }; },
  });

  await assert.rejects(
    () => new RefreshSessions().rotate({ token: 'r'.repeat(48), scope: 'partner' }),
    /already used/,
  );
  assert.equal(familyRevoked, 1);
});
