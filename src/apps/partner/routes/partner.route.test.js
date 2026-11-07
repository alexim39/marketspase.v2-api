import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileUpdateSchema } from './partner.route.js';

const base = {
  id: '6aef5ebc991cc87960be8574',
  name: 'Async',
  surname: 'Contact',
  email: 'async.contacts@gmail.com',
  phone: '08080362562',
};

test('a null bio from an empty profile field is treated as blank', () => {
  const parsed = ProfileUpdateSchema.parse({ ...base, bio: null });
  assert.equal(parsed.bio, '');
});

test('an omitted bio stays omitted so existing copy is not cleared', () => {
  const parsed = ProfileUpdateSchema.parse({ ...base });
  assert.equal(parsed.bio, undefined);
});

test('null address and date fields are tolerated', () => {
  const parsed = ProfileUpdateSchema.parse({
    ...base,
    bio: null,
    address: { street: null, city: null, state: null, country: null },
    dobDatePicker: null,
  });
  assert.deepEqual(parsed.address, { street: '', city: '', state: '', country: '' });
  assert.equal(parsed.dobDatePicker, undefined);
});

test('a null address object is ignored instead of failing', () => {
  const parsed = ProfileUpdateSchema.parse({ ...base, address: null });
  assert.equal(parsed.address, undefined);
});

test('an over-long bio is still rejected', () => {
  assert.throws(() => ProfileUpdateSchema.parse({ ...base, bio: 'x'.repeat(1001) }));
});
