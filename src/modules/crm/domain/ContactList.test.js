import test from 'node:test';
import assert from 'node:assert/strict';
import { prospectPhoneAccess } from './ContactList.js';

test('phone is shared only with a consenting direct referral upline', () => {
  assert.deepEqual(
    prospectPhoneAccess({ consentToContact: true, directUpline: true, hasPhone: true }),
    { visible: true, reason: null },
  );
});

test('phone is hidden without consent even for the direct upline', () => {
  assert.deepEqual(
    prospectPhoneAccess({ consentToContact: false, directUpline: true, hasPhone: true }),
    { visible: false, reason: 'no-consent' },
  );
});

test('phone is hidden from indirect uplines even when consent exists', () => {
  assert.deepEqual(
    prospectPhoneAccess({ consentToContact: true, directUpline: false, hasPhone: true }),
    { visible: false, reason: 'not-direct' },
  );
});

test('a missing phone number is reported separately', () => {
  assert.deepEqual(
    prospectPhoneAccess({ consentToContact: true, directUpline: true, hasPhone: false }),
    { visible: false, reason: 'no-phone' },
  );
});
