import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { RecordReservationUseCase } from './Reservations.usecases.js';
import { ForbiddenException, NotFoundException } from '../../../shared/domain/AppError.js';

// Same guard as production (buffered model calls fail fast instead of hanging).
mongoose.set('bufferTimeoutMS', 50);

const OWNER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const UPLINE = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const OUTSIDER = 'cccccccccccccccccccccccc';
const PROSPECT = 'dddddddddddddddddddddddd';

const fakeStore = () => ({
  lastRecord: null,
  async record(input) {
    this.lastRecord = { ...input };
    return {
      id: 'r1', code: input.code, status: 'Approved',
      partnerId: String(input.partnerId),
      prospectId: input.prospectId ? String(input.prospectId) : null,
      recordedBy: input.recordedBy ? String(input.recordedBy) : null,
    };
  },
});

// Prospect access: OWNER owns PROSPECT, UPLINE is above them, everyone else is a stranger.
const fakeAccess = () => ({
  async requireSupport(requesterId, prospectId) {
    if (prospectId !== PROSPECT) throw new NotFoundException('Prospect not found');
    if (String(requesterId) === OWNER) return { ownerId: OWNER, relation: 'owner' };
    if (String(requesterId) === UPLINE) return { ownerId: OWNER, relation: 'upline' };
    if (String(requesterId).toLowerCase() === 'admin') return { ownerId: OWNER, relation: 'admin' };
    throw new NotFoundException('Prospect not found');
  },
});

const uc = (store = fakeStore()) => new RecordReservationUseCase({ reservations: store, access: fakeAccess() });

describe('RecordReservationUseCase — credit routing', () => {
  it('self-record without a prospect keeps today’s shape (beneficiary = session, no actor)', async () => {
    const store = fakeStore();
    const res = await uc(store).execute({ referrerId: OWNER, code: 'NV000001' });
    assert.equal(res.partnerId, OWNER);
    assert.equal(res.recordedBy, null);
    assert.equal(store.lastRecord.partnerId, OWNER);
    assert.equal('recordedBy' in store.lastRecord, false);
  });

  it('owner self-record with own prospectId is unchanged (beneficiary = owner, no actor)', async () => {
    const store = fakeStore();
    const res = await uc(store).execute({ referrerId: OWNER, code: 'NV000002', prospectId: PROSPECT });
    assert.equal(res.partnerId, OWNER);
    assert.equal(res.recordedBy, null);
  });

  it('upline promote-on-behalf routes credit to the owner and stamps the actor', async () => {
    const store = fakeStore();
    const res = await uc(store).execute({
      referrerId: UPLINE, code: 'NV000003', prospectId: PROSPECT, onBehalfOf: OWNER,
    });
    assert.equal(res.partnerId, OWNER);
    assert.equal(res.recordedBy, UPLINE);
    assert.equal(store.lastRecord.partnerId, OWNER);
  });

  it('upline with prospectId but no onBehalfOf defaults to the owner (never self-credit)', async () => {
    const store = fakeStore();
    const res = await uc(store).execute({ referrerId: UPLINE, code: 'NV000004', prospectId: PROSPECT });
    assert.equal(res.partnerId, OWNER);
    assert.equal(res.recordedBy, UPLINE);
  });

  it('outsiders fail closed without confirming the prospect', async () => {
    await assert.rejects(
      uc().execute({ referrerId: OUTSIDER, code: 'NV000005', prospectId: PROSPECT }),
      NotFoundException,
    );
  });

  it('rejects onBehalfOf that does not match the prospect owner', async () => {
    await assert.rejects(
      uc().execute({ referrerId: UPLINE, code: 'NV000006', prospectId: PROSPECT, onBehalfOf: OUTSIDER }),
      /must match the prospect owner/,
    );
  });

  it('rejects onBehalfOf without a prospect', async () => {
    await assert.rejects(
      uc().execute({ referrerId: UPLINE, code: 'NV000007', onBehalfOf: OWNER }),
      /requires a prospect/,
    );
  });

  it('rejects malformed codes and ids at the entity boundary', async () => {
    await assert.rejects(uc().execute({ referrerId: OWNER, code: 'x' }), /Invalid reservation code/);
    await assert.rejects(
      uc().execute({ referrerId: OWNER, code: 'NV000008', prospectId: 'nope' }),
      /Invalid prospect id/,
    );
  });

  it('uses the real ForbiddenException export (contract check)', async () => {
    assert.equal(typeof ForbiddenException, 'function');
  });
});
