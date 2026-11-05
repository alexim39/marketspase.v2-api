import test from 'node:test';
import assert from 'node:assert/strict';
import { maskProspectContact, prospectContactAccess } from './Prospect.visibility.js';

const prospect = {
  prospectPhone: '08010000001',
  prospectEmail: 'ada@example.com',
  bestTimeToCall: '6pm',
  consentToContact: true,
};

test('owner/admin bypass consent and keep contact details', () => {
  const result = maskProspectContact({ ...prospect, consentToContact: false }, {
    canViewContact: true,
    bypassConsent: true,
  });
  assert.equal(result.prospectPhone, '08010000001');
  assert.equal(result.prospectEmail, 'ada@example.com');
  assert.equal(result.phoneHiddenReason, null);
  assert.equal(result.emailHiddenReason, null);
});

test('direct upline sees details only with consent', () => {
  const result = maskProspectContact(prospect, { canViewContact: true });
  assert.equal(result.prospectPhone, '08010000001');
  assert.equal(result.prospectEmail, 'ada@example.com');
});

test('direct upline without consent gets nulls and a reason', () => {
  const result = maskProspectContact({ ...prospect, consentToContact: false }, { canViewContact: true });
  assert.equal(result.prospectPhone, null);
  assert.equal(result.prospectEmail, null);
  assert.equal(result.bestTimeToCall, null);
  assert.equal(result.phoneHiddenReason, 'no-consent');
  assert.equal(result.emailHiddenReason, 'no-consent');
});

test('indirect upline never sees contact details', () => {
  const result = maskProspectContact(prospect, { canViewContact: false });
  assert.equal(result.prospectPhone, null);
  assert.equal(result.prospectEmail, null);
  assert.equal(result.phoneHiddenReason, 'not-direct');
  assert.equal(result.emailHiddenReason, 'not-direct');
});

test('a missing field is reported separately after access passes', () => {
  const access = prospectContactAccess({ consentToContact: true, canViewContact: true });
  assert.deepEqual(access, { visible: true, reason: null });
  const result = maskProspectContact({ ...prospect, prospectPhone: '' }, { canViewContact: true });
  assert.equal(result.phoneHiddenReason, 'no-phone');
});
