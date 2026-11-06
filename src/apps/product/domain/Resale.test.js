import assert from 'node:assert/strict';
import test from 'node:test';
import { canBuyResale, cartSaleMode, resalePrices } from './Resale.js';

test('canBuyResale requires an active verified partner', () => {
  assert.equal(canBuyResale({ accountState: 'partner', kycStatus: 'verified' }), true);
  assert.equal(canBuyResale({ accountState: 'partner' }), true, 'legacy partners without a KYC stamp are trusted');
  assert.equal(canBuyResale({ accountState: 'member', kycStatus: 'verified' }), false);
  assert.equal(canBuyResale({ accountState: 'partner', kycStatus: 'pending' }), false);
  assert.equal(canBuyResale({ accountState: 'partner', kycStatus: 'verified', suspendedAt: new Date() }), false);
  assert.equal(canBuyResale(null), false);
});

test('resalePrices uses partnerPrice and falls back to the retail price', () => {
  assert.deepEqual(resalePrices({ partnerPrice: 16000, retailPrice: 20000, price: 21000 }), {
    partnerPrice: 16000,
    retailPrice: 20000,
  });
  assert.deepEqual(resalePrices({ partnerPrice: 16000, retailPrice: 0, price: 21000 }), {
    partnerPrice: 16000,
    retailPrice: 21000,
  });
  assert.deepEqual(resalePrices({ partnerPrice: 0, retailPrice: 0, price: 0 }), {
    partnerPrice: 0,
    retailPrice: 0,
  });
});

test('cartSaleMode labels personal, resale and mixed carts', () => {
  assert.equal(cartSaleMode([]), 'personal');
  assert.equal(cartSaleMode([{ saleMode: 'personal' }]), 'personal');
  assert.equal(cartSaleMode([{ saleMode: 'resale' }, { saleMode: 'resale' }]), 'resale');
  assert.equal(cartSaleMode([{ saleMode: 'personal' }, { saleMode: 'resale' }]), 'mixed');
});
