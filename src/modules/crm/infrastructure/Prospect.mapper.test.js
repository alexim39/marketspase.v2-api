import test from 'node:test';
import assert from 'node:assert/strict';
import { ProspectMapper } from './Prospect.mapper.js';

test('a converted lead exposes the partner it joined', () => {
  const joinedAt = new Date('2026-11-08T09:00:00Z');
  const lead = ProspectMapper.toDomain({
    _id: 'lead-1',
    partnerId: 'owner-1',
    prospectName: 'Emeka',
    prospectPhone: '08012345678',
    status: { stage: 'Converted' },
    convertedPartnerId: 'partner-1',
    convertedAt: joinedAt,
  });

  assert.equal(lead.convertedPartnerId, 'partner-1');
  assert.equal(lead.convertedAt, joinedAt);
  assert.equal(lead.partnerId, 'owner-1');
});
