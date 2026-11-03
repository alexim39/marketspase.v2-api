import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ListReviewQueueUseCase, DeleteReservationUseCase, DecideReservationUseCase } from './Reservations.usecases.js';

// The usecase labels via real models directly; without a connection those
// buffer — fail fast into the built-in catch fallbacks instead of hanging.
mongoose.set('bufferTimeoutMS', 50);

const row = (over = {}) => ({
  id: 'r1', code: 'NV000001', status: 'Pending', partnerId: 'u1', prospectId: null,
  createdAt: new Date().toISOString(), ...over,
});

const fakeReservations = (rows = [], heldCodes = new Set()) => ({
  lastList: null,
  async listByStatus(status, limit, skip, q) {
    this.lastList = { status, limit, skip, q };
    return { items: rows, total: rows.length };
  },
  async statusSummary() {
    return { Pending: 1, Approved: 0, Rejected: 0, Used: 0 };
  },
  async findById(id) {
    return rows.find((r) => r.id === id) ?? null;
  },
  async hardDelete(id) {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return null;
    const [gone] = rows.splice(i, 1);
    return { id: gone.id, code: gone.code, status: gone.status };
  },
  heldCodes,
});

describe('ListReviewQueueUseCase', () => {
  it('passes search text and returns summary beside rows', async () => {
    const uc = new ListReviewQueueUseCase({ reservations: fakeReservations([row()]) });
    const res = await uc.execute({ status: 'All', limit: 25, skip: 0, q: 'NV00' });
    assert.equal(res.total, 1);
    assert.deepEqual(res.items[0].issuer, { username: 'u1', name: 'Former member' }); // dangling ref, honest fallback
    assert.equal(res.items[0].consumer, null);
    assert.deepEqual(res.summary, { Pending: 1, Approved: 0, Rejected: 0, Used: 0 });
  });

  it('rejects unknown status filters', async () => {
    const uc = new ListReviewQueueUseCase({ reservations: fakeReservations([]) });
    await assert.rejects(uc.execute({ status: 'nope' }), /Invalid status filter/);
  });

  it("treats legacy 'undefined' partnerId strings as missing", async () => {
    const fake = fakeReservations([row({ partnerId: 'undefined' })]);
    const uc = new ListReviewQueueUseCase({ reservations: fake });
    const res = await uc.execute({ status: 'All' });
    assert.equal(res.items[0].issuer, null);
    assert.equal(res.items[0].issuerUpline, null);
  });
});

describe('DeleteReservationUseCase', () => {
  it('deletes pending and rejected codes', async () => {
    const uc = new DeleteReservationUseCase({
      reservations: fakeReservations([row({ id: 'a' }), row({ id: 'b', status: 'Rejected' })]),
    });
    assert.equal((await uc.execute({ reservationId: 'a' })).code, 'NV000001');
    assert.equal((await uc.execute({ reservationId: 'b' })).status, 'Rejected');
  });

  it('refuses used codes and unknown ids', async () => {
    const uc = new DeleteReservationUseCase({
      reservations: fakeReservations([row({ id: 'u', status: 'Used' })]),
    });
    await assert.rejects(uc.execute({ reservationId: 'u' }), /history/);
    await assert.rejects(uc.execute({ reservationId: 'ghost' }), /not found/i);
  });
});

describe('DecideReservationUseCase transitions', () => {
  const decidingStore = (status) => ({
    async findById() {
      return { id: 'r1', code: 'NV1', status, partnerId: 'u1' };
    },
    async decide(id, next, from) {
      assert.deepEqual(from, [status]);
      return { id, code: 'NV1', status: next, partnerId: 'u1' };
    },
  });

  it('moves Approved back to Pending or Rejected', async () => {
    for (const next of ['Pending', 'Rejected']) {
      const uc = new DecideReservationUseCase({ reservations: decidingStore('Approved') });
      const res = await uc.execute({ reservationId: 'r1', status: next });
      assert.equal(res.status, next);
    }
  });

  it('reconsiders Rejected codes and keeps Used terminal', async () => {
    const back = new DecideReservationUseCase({ reservations: decidingStore('Rejected') });
    assert.equal((await back.execute({ reservationId: 'r1', status: 'Pending' })).status, 'Pending');

    const used = new DecideReservationUseCase({ reservations: decidingStore('Used') });
    await assert.rejects(used.execute({ reservationId: 'r1', status: 'Pending' }), /history/);
  });

  it('rejects unknown targets and unknown ids', async () => {
    const uc = new DecideReservationUseCase({ reservations: decidingStore('Pending') });
    await assert.rejects(uc.execute({ reservationId: 'r1', status: 'Used' }), /Invalid status/);
    const missing = new DecideReservationUseCase({
      findById: undefined,
      reservations: { findById: async () => null },
    });
    await assert.rejects(missing.execute({ reservationId: 'ghost', status: 'Approved' }), /not found/i);
  });
});

describe('DeleteReservationUseCase owner guard', () => {
  const ownedStore = () => ({
    async findById(id) {
      return { id, code: 'NV1', status: 'Pending', partnerId: 'owner1' };
    },
    async hardDelete(id) {
      return { id, code: 'NV1', status: 'Pending' };
    },
  });

  it('allows the owner', async () => {
    const uc = new DeleteReservationUseCase({ reservations: ownedStore() });
    const res = await uc.execute({ reservationId: 'r1', ownerId: 'owner1' });
    assert.equal(res.code, 'NV1');
  });

  it('rejects strangers with 403', async () => {
    const uc = new DeleteReservationUseCase({ reservations: ownedStore() });
    await assert.rejects(uc.execute({ reservationId: 'r1', ownerId: 'stranger' }), /only delete codes you recorded/);
  });
});
