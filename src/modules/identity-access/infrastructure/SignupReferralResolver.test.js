import test from 'node:test';
import assert from 'node:assert/strict';
import { SignupReferralResolver, isActiveReferrer } from './SignupReferralResolver.js';

const leadId = '507f1f77bcf86cd799439011';
const emailLeadId = '507f1f77bcf86cd799439012';

const active = (id, username, over = {}) => ({
  _id: id,
  username,
  accountState: 'partner',
  kycStatus: 'verified',
  suspendedAt: null,
  ...over,
});

const partnersById = {
  aisha: active('aisha', 'aisha'),
  tunde: active('tunde', 'tunde'),
  inactive: active('inactive', 'inactive', { accountState: 'member' }),
  pendingKyc: active('pendingKyc', 'pendingkyc', { kycStatus: 'pending' }),
};

const leadsById = {
  [leadId]: { _id: leadId, partnerId: 'aisha', prospectEmail: 'emeka@example.com' },
  [emailLeadId]: { _id: emailLeadId, partnerId: 'tunde', prospectEmail: 'emeka@example.com' },
};

const query = (value) => ({ lean: async () => value });

const makeResolver = () => {
  let bound = null;
  const resolver = new SignupReferralResolver({
    partners: {
      findOne: async (filter) => {
        const username = filter?.username;
        return query(Object.values(partnersById).find((p) => p.username === username) ?? null);
      },
      findById: async (id) => query(partnersById[String(id)] ?? null),
    },
    prospects: {
      findOne: async (filter) => {
        if (filter?._id) return query(leadsById[String(filter._id)] ?? null);
        if (filter?.prospectEmail) {
          const pattern = filter.prospectEmail instanceof RegExp ? filter.prospectEmail : null;
          const match = Object.values(leadsById).find((lead) => (
            lead.prospectEmail === 'emeka@example.com'
            && (!pattern || pattern.test(lead.prospectEmail))
          ));
          return query(match ?? null);
        }
        return query(null);
      },
      updateOne: async (filter, update) => {
        bound = { filter, update };
        return { modifiedCount: 1 };
      },
    },
  });
  return { resolver, bound: () => bound };
};

test('an active referral becomes the sponsor', async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve({ ref: '@Aisha', email: 'emeka@example.com' });
  assert.equal(result.ownerId, 'aisha');
  assert.equal(result.source, 'referral');
  assert.equal(result.systemOwned, false);
});

test('an inactive referrer falls back to system-owned instead of rejecting signup', async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve({ ref: 'inactive', email: 'new@example.com' });
  assert.equal(result.ownerId, null);
  assert.equal(result.systemOwned, true);
  assert.equal(result.source, 'inactive-referrer');
});

test('an unknown referrer falls back to system-owned', async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve({ ref: 'missing', email: 'new@example.com' });
  assert.equal(result.ownerId, null);
  assert.equal(result.systemOwned, true);
});

test('a converted pipeline lead resolves its owner even without a ref', async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve({ leadId, email: 'brand-new@example.com' });
  assert.equal(result.ownerId, 'aisha');
  assert.equal(result.source, 'converted-lead');
  assert.equal(result.prospectId, leadId);
});

test('a converted prospect is matched by signup email as a safety net', async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve({ email: 'Emeka@Example.com' });
  assert.equal(result.ownerId, 'aisha');
  assert.equal(result.source, 'converted-lead-email');
});

test('an explicit active referral wins over a lead owned by someone else', async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve({ ref: 'tunde', leadId, email: 'emeka@example.com' });
  assert.equal(result.ownerId, 'tunde');
  assert.equal(result.source, 'referral');
  assert.equal(result.prospectId, null);
});

test('pending KYC cannot own a referral', async () => {
  const { resolver } = makeResolver();
  const result = await resolver.resolve({ ref: 'pendingKyc', email: 'new@example.com' });
  assert.equal(result.ownerId, null);
  assert.equal(result.systemOwned, true);
  assert.equal(isActiveReferrer(partnersById.pendingKyc), false);
});

test('binding a converted lead records the partner account', async () => {
  const { resolver, bound } = makeResolver();
  const result = await resolver.bindProspect(leadId, 'partner-1');
  assert.equal(result.bound, true);
  assert.equal(String(bound().filter._id), leadId);
  assert.equal(String(bound().update.$set.convertedPartnerId), 'partner-1');
  assert.ok(bound().update.$set.convertedAt instanceof Date);
});
