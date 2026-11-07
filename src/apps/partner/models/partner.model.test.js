import test from 'node:test';
import assert from 'node:assert/strict';
import { PartnersModel, applyDobSave, sealPartnerUpdate } from './partner.model.js';
import { isSealed, open } from '../../../shared/security/fieldCrypto.js';

test('partner writes seal address fields and DOB', () => {
  const update = {
    $set: {
      address: {
        street: '12 Market Road',
        city: 'Port Harcourt',
        state: 'Rivers',
        country: 'Nigeria',
      },
      dobDatePicker: '1990-04-05',
    },
  };

  sealPartnerUpdate(update);

  assert.ok(isSealed(update.$set.address.street));
  assert.ok(isSealed(update.$set.address.city));
  assert.ok(isSealed(update.$set.address.state));
  assert.ok(isSealed(update.$set.address.country));
  assert.equal(open(update.$set.address.street), '12 Market Road');
  assert.ok(isSealed(update.$set.dobDatePicker));
  assert.equal(open(update.$set.dobDatePicker), '1990-04-05');
  assert.equal(update.$set.dobMonth, 4);
  assert.equal(update.$set.dobDay, 5);
});

test('partner reads open sealed address and DOB', () => {
  const write = {
    $set: {
      address: { street: '12 Market Road', city: 'Port Harcourt', state: 'Rivers', country: 'Nigeria' },
      dobDatePicker: '1990-04-05',
    },
  };
  sealPartnerUpdate(write);

  const doc = PartnersModel.hydrate({
    _id: '507f1f77bcf86cd799439011',
    address: write.$set.address,
    dobDatePicker: write.$set.dobDatePicker,
  });

  assert.equal(doc.address.street, '12 Market Road');
  assert.equal(doc.address.state, 'Rivers');
  assert.equal(doc.dobDatePicker, '1990-04-05');
  assert.equal(doc.toObject().address.street, '12 Market Road');
  assert.equal(doc.toObject().dobDatePicker, '1990-04-05');
  assert.equal(JSON.parse(JSON.stringify(doc)).address.city, 'Port Harcourt');
});

test('clearing DOB clears the sealed value and derived parts', () => {
  const update = { $set: { dobDatePicker: null } };
  sealPartnerUpdate(update);

  assert.equal(update.$set.dobDatePicker, null);
  assert.equal(update.$set.dobMonth, undefined);
  assert.equal(update.$set.dobDay, undefined);
  assert.deepEqual(update.$unset, { dobMonth: 1, dobDay: 1 });
});

test('document saves seal DOB and keep derived calendar parts', () => {
  const doc = PartnersModel.hydrate({
    _id: '507f1f77bcf86cd799439012',
    dobDatePicker: new Date('1991-02-03T00:00:00.000Z'),
  });
  doc.markModified('dobDatePicker');

  applyDobSave(doc);

  assert.ok(isSealed(doc.get('dobDatePicker', null, { getters: false })));
  assert.equal(doc.dobMonth, 2);
  assert.equal(doc.dobDay, 3);
});
