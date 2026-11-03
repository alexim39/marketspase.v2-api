import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMS_CHARGE_PER_PAGE, smsPages, smsCost, createBulkSmsEntity,
  normalizeNgPhone, MAX_SMS_RECIPIENTS,
} from './Outreach.entity.js';

test('rate stays profitable: above the ≈₦6.49 gateway unit cost', () => {
  assert.ok(SMS_CHARGE_PER_PAGE > 6.49, `rate ₦${SMS_CHARGE_PER_PAGE} must beat gateway cost`);
});

test('pages and cost math', () => {
  assert.equal(smsPages('x'.repeat(160)), 1);
  assert.equal(smsPages('x'.repeat(161)), 2);
  assert.equal(smsCost(3, 'x'.repeat(161)), 3 * 2 * SMS_CHARGE_PER_PAGE);
});

test('entity validates recipients, dedupes, and stamps cost', () => {
  const e = createBulkSmsEntity({ to: ['08031234567', '+2348031234567', '08031234567'], body: 'Hi' });
  assert.deepEqual(e.to, ['08031234567']);
  assert.equal(e.pages, 1);
  assert.equal(e.cost, SMS_CHARGE_PER_PAGE);
  assert.throws(() => createBulkSmsEntity({ to: ['123'], body: 'Hi' }), /Invalid Nigerian mobile/);
  assert.throws(
    () => createBulkSmsEntity({ to: Array(MAX_SMS_RECIPIENTS + 1).fill('08031234567'), body: 'Hi' }),
    /At most/,
  );
});

test('normalizeNgPhone accepts local and international NG mobiles only', () => {
  assert.equal(normalizeNgPhone('08031234567'), '08031234567');
  assert.equal(normalizeNgPhone('+2348031234567'), '08031234567');
  assert.equal(normalizeNgPhone('2348031234567'), '08031234567');
  assert.equal(normalizeNgPhone('+15551234567'), null);
  assert.equal(normalizeNgPhone('abc'), null);
});
