import test from 'node:test';
import assert from 'node:assert/strict';
import { ProlificWomanLeadMongooseModel } from './Lead.schema.js';

test('prolific woman leads live in an isolated collection', () => {
  assert.equal(ProlificWomanLeadMongooseModel.collection.name, 'prolificwoman-leads');
  assert.ok(ProlificWomanLeadMongooseModel.schema.path('name'));
  assert.ok(ProlificWomanLeadMongooseModel.schema.path('phone'));
  assert.ok(ProlificWomanLeadMongooseModel.schema.path('location'));
  assert.deepEqual(
    ProlificWomanLeadMongooseModel.schema.path('availability').options.enum,
    ['weekdays', 'weekends'],
  );
  assert.ok(ProlificWomanLeadMongooseModel.schema.path('acceptedAt'));
  assert.ok(ProlificWomanLeadMongooseModel.schema.path('acceptedByPartnerId'));
  assert.ok(ProlificWomanLeadMongooseModel.schema.path('prospectId'));
});
