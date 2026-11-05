import test from 'node:test';
import assert from 'node:assert/strict';
import { maskEmail, maskPartnerContact, maskPhone } from './ContactMask.js';

test('masks email local parts while preserving the domain', () => {
  assert.equal(maskEmail('aleximenwo@gmail.com'), 'alexi*****@gmail.com');
  assert.equal(maskEmail('ago.fnc@gmail.com'), 'ago.***@gmail.com');
  assert.equal(maskEmail('qa.privacy.downline@example.com'), 'qa.pr*****@example.com');
  assert.equal(maskEmail('a@example.com'), 'a***@example.com');
  assert.equal(maskEmail(''), '');
});

test('masks phone numbers after the first four characters', () => {
  assert.equal(maskPhone('08081234567'), '0808***');
  assert.equal(maskPhone('+234 801 234 5678'), '+234***');
  assert.equal(maskPhone('123'), '***');
});

test('masks a partner clone without mutating the source', () => {
  const source = {
    email: 'aleximenwo@gmail.com',
    phone: '08081234567',
    displayEmail: 'aleximenwo@gmail.com',
    displayPhone: '08081234567',
    username: 'aimenwo',
  };
  const out = maskPartnerContact(source);
  assert.equal(out.email, 'alexi*****@gmail.com');
  assert.equal(out.phone, '0808***');
  assert.equal(out.displayEmail, 'alexi*****@gmail.com');
  assert.equal(out.displayPhone, '0808***');
  assert.equal(out.username, 'aimenwo');
  assert.equal(source.email, 'aleximenwo@gmail.com');
  assert.equal(source.phone, '08081234567');
});
