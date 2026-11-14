import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin } from './origins.js';

test('allows the production store and platform origins', () => {
  assert.equal(isAllowedOrigin('https://store.marketspase.com'), true);
  assert.equal(isAllowedOrigin('https://marketspase.com'), true);
  assert.equal(isAllowedOrigin('https://admin.marketspase.com'), true);
});

test('rejects an unknown origin', () => {
  assert.equal(isAllowedOrigin('https://evil.example.com'), false);
});
