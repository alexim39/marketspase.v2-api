import test from 'node:test';
import assert from 'node:assert/strict';
import { ListDownlineContactListsUseCase, ResolveContactByPhoneUseCase } from './ContactList.usecases.js';

const now = new Date('2026-11-05T10:00:00Z');

test('downline warm lists expose phones only to consenting direct referrals', async () => {
  const network = {
    async findChildren(parentIds, _limit, chain) {
      const ids = parentIds.map(String);
      if (chain === 'referral') return ids.includes('me') ? [{ id: 'direct' }] : [];
      if (ids.includes('me')) return [{ id: 'direct' }];
      if (ids.includes('direct')) return [{ id: 'indirect' }];
      return [];
    },
    async findNodesByIds(ids) {
      return ids.map((id) => ({ id: String(id), username: String(id), name: String(id), surname: '' }));
    },
  };
  const prospects = {
    async downlineSubmittedBatches() {
      return [
        { partnerId: 'direct', batch: 'b1', submittedAt: now, total: 2, worked: 0, stageCounts: { New: 2 } },
        { partnerId: 'indirect', batch: 'b2', submittedAt: now, total: 1, worked: 0, stageCounts: { New: 1 } },
      ];
    },
    async submittedContacts() {
      return [
        { id: 'c1', partnerId: 'direct', listBatch: 'b1', prospectName: 'Consented', prospectPhone: '08010000001', consentToContact: true, status: { stage: 'New' } },
        { id: 'c2', partnerId: 'direct', listBatch: 'b1', prospectName: 'No consent', prospectPhone: '08010000002', consentToContact: false, status: { stage: 'New' } },
        { id: 'c3', partnerId: 'indirect', listBatch: 'b2', prospectName: 'Indirect', prospectPhone: '08010000003', consentToContact: true, status: { stage: 'New' } },
      ];
    },
  };

  const result = await new ListDownlineContactListsUseCase({ prospects, network })
    .execute({ requesterId: 'me', now });
  assert.equal(result.items.length, 2);
  const direct = result.items.find((item) => item.partnerId === 'direct');
  const indirect = result.items.find((item) => item.partnerId === 'indirect');
  assert.equal(direct?.directUpline, true);
  assert.equal(indirect?.directUpline, false);

  const consented = direct?.contacts.find((contact) => contact.id === 'c1');
  const noConsent = direct?.contacts.find((contact) => contact.id === 'c2');
  const indirectContact = indirect?.contacts.find((contact) => contact.id === 'c3');
  assert.equal(consented?.prospectPhone, '08010000001');
  assert.equal(consented?.phoneHiddenReason, null);
  assert.equal(noConsent?.prospectPhone, null);
  assert.equal(noConsent?.phoneHiddenReason, 'no-consent');
  assert.equal(indirectContact?.prospectPhone, null);
  assert.equal(indirectContact?.phoneHiddenReason, 'not-direct');
});

test('phone resolver returns ids only for a unique scoped match', async () => {
  const network = { findChildren: async () => [] };
  const prospects = {
    findByPhoneInPartners: async (ids, phone, limit) => {
      assert.deepEqual(ids, ['me']);
      assert.equal(phone, '08010000001');
      assert.equal(limit, 3);
      return [{ prospectId: 'p1', partnerId: 'direct' }];
    },
  };
  const result = await new ResolveContactByPhoneUseCase({ prospects, network })
    .execute({ requesterId: 'me', phone: '08010000001' });
  assert.deepEqual(result.match, { prospectId: 'p1', partnerId: 'direct' });
});

test('phone resolver refuses ambiguous matches', async () => {
  const network = { findChildren: async () => [] };
  const prospects = {
    findByPhoneInPartners: async () => [
      { prospectId: 'p1', partnerId: 'a' },
      { prospectId: 'p2', partnerId: 'b' },
    ],
  };
  const result = await new ResolveContactByPhoneUseCase({ prospects, network })
    .execute({ requesterId: 'me', phone: '08010000001' });
  assert.equal(result.match, null);
});
