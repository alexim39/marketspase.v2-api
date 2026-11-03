import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SendDirectUseCase, GetThreadUseCase, SearchPeopleUseCase } from './Messaging.usecases.js';

const OID = (n) => String(n).padStart(24, 'c');

describe('open messaging', () => {
  it('sends to partners outside the upline/downline', async () => {
    let saved = null;
    const uc = new SendDirectUseCase({
      network: { async findNode() { return { id: OID(2) }; } },
      partners: { findById: () => ({ select: () => ({ lean: async () => ({ _id: OID(2) }) }) }) },
      messages: { async create(doc) { saved = doc; return { id: OID(9), ...doc }; } },
    });
    const res = await uc.execute({ senderId: OID(1), to: OID(2), body: 'hello stranger' });
    assert.equal(res.recipientId, OID(2));
    assert.equal(saved.kind, 'direct');
  });

  it('still rejects self-messages and unknown partners', async () => {
    const uc = new SendDirectUseCase({
      network: { async findNode() { return null; } },
      partners: { findById: () => ({ select: () => ({ lean: async () => null }) }) },
      messages: { async create() { throw new Error('should not persist'); } },
    });
    await assert.rejects(uc.execute({ senderId: OID(1), to: OID(1), body: 'hi' }), /yourself/);
    await assert.rejects(uc.execute({ senderId: OID(1), to: OID(2), body: 'hi' }), /not found/i);
  });

  it('opens threads with strangers once they exist', async () => {
    const rows = [{ id: OID(7) }];
    const partners = { findById: (id) => ({ select: () => ({ lean: async () => (String(id).length === 24 ? { _id: id } : null) }) }) };
    const uc = new GetThreadUseCase({
      messages: { async thread() { return rows; } },
      partners,
    });
    assert.deepEqual(await uc.execute({ partnerId: OID(1), counterpartId: OID(2) }), rows);
    const missing = new GetThreadUseCase({ messages: { async thread() { return []; } }, partners: { findById: () => ({ select: () => ({ lean: async () => null }) }) } });
    await assert.rejects(missing.execute({ partnerId: OID(1), counterpartId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }), /not found/i);
  });

  it('passes the before cursor through to the store for paged threads', async () => {
    let seen = null;
    const partners = { findById: () => ({ select: () => ({ lean: async () => ({ _id: OID(2) }) }) }) };
    const uc = new GetThreadUseCase({
      messages: { async thread(...args) { seen = args; return []; } },
      partners,
    });
    await uc.execute({ partnerId: OID(1), counterpartId: OID(2), limit: 50, before: '2026-01-01T00:00:00.000Z' });
    assert.deepEqual(seen, [OID(1), OID(2), 50, '2026-01-01T00:00:00.000Z']);
  });

  it('searches people by username or name (safe fields only)', async () => {
    const docs = [
      { _id: OID(2), username: 'coachada', name: 'Ada', surname: 'Obi', profileImage: 'uploads/a.png' },
      { _id: OID(3), username: 'teammate', name: 'Tea', surname: 'Mate', profileImage: null },
    ];
    const uc = new SearchPeopleUseCase({
      partners: {
        find(query) {
          assert.ok(query.$or.length === 3);
          return { select: () => ({ limit: () => ({ lean: async () => docs }) }) };
        },
      },
    });
    // Fake store ignores the filter; assert shaping + self-exclusion instead.
    const rows = await uc.execute({ q: 'ada', excludeId: OID(2) });
    assert.ok(rows.every((r) => r.id !== OID(2)));
    assert.ok(rows.every((r) => !('phone' in r) && !('email' in r)));
    assert.deepEqual(await uc.execute({ q: 'x' }), []);
  });
});
