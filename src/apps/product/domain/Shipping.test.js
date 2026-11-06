import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanShipping } from './Shipping.js';

test('cleanShipping trims fields and defaults the country', () => {
  const result = cleanShipping({
    fullName: '  Ada Obi ',
    phone: ' 0803 000 0000 ',
    street: ' 12 Market Road ',
    city: ' Enugu ',
    state: ' Enugu ',
    notes: ' Call on arrival ',
  });

  assert.deepEqual(result, {
    fullName: 'Ada Obi',
    phone: '0803 000 0000',
    street: '12 Market Road',
    city: 'Enugu',
    state: 'Enugu',
    country: 'Nigeria',
    notes: 'Call on arrival',
  });
});

test('cleanShipping rejects incomplete delivery addresses', () => {
  assert.equal(cleanShipping(null), null);
  assert.equal(cleanShipping({}), null);
  assert.equal(cleanShipping({
    fullName: 'Ada Obi',
    phone: '0803',
    street: '12 Market Road',
    city: 'Enugu',
  }), null);
});

test('cleanShipping caps long values', () => {
  const result = cleanShipping({
    fullName: 'A'.repeat(200),
    phone: '0'.repeat(80),
    street: 'B'.repeat(400),
    city: 'C'.repeat(200),
    state: 'D'.repeat(200),
    country: 'E'.repeat(120),
    notes: 'F'.repeat(900),
  });

  assert.equal(result.fullName.length, 120);
  assert.equal(result.phone.length, 40);
  assert.equal(result.street.length, 240);
  assert.equal(result.city.length, 120);
  assert.equal(result.state.length, 120);
  assert.equal(result.country.length, 80);
  assert.equal(result.notes.length, 500);
});
