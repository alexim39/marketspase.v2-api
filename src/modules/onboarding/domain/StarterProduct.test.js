import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESSENTIAL_STARTER_PRODUCT,
  SIGNATURE_STARTER_PRODUCT,
  STARTER_PRODUCTS,
  STARTER_PRODUCT,
  UPGRADE_HANDLING_FEE_NGN,
  starterProductBySku,
  starterProductByTier,
  upgradePriceFor,
} from './StarterProduct.js';

const round = (value) => Math.round(value * 100) / 100;

describe('activation plans', () => {
  it('keeps the Signature plan exactly as it was', () => {
    assert.equal(STARTER_PRODUCT, SIGNATURE_STARTER_PRODUCT);
    assert.equal(SIGNATURE_STARTER_PRODUCT.sku, 'MS-STARTER-001');
    assert.equal(SIGNATURE_STARTER_PRODUCT.price, 38000);
    assert.equal(SIGNATURE_STARTER_PRODUCT.cogs, 16000);
    assert.equal(SIGNATURE_STARTER_PRODUCT.shippingCost, 3000);
    assert.equal(SIGNATURE_STARTER_PRODUCT.imageUrl, '/img/activation-hoodi.jpeg');
  });

  it('prices the Essential plan inside the approved cost caps', () => {
    const plan = ESSENTIAL_STARTER_PRODUCT;
    assert.equal(plan.sku, 'MS-STARTER-002');
    assert.equal(plan.price, 12500);
    assert.ok(plan.cogs <= 5000, 'COGS must stay within the approved cap');
    assert.ok(plan.shippingCost <= 2700, 'shipping must stay within the approved cap');
    assert.equal(plan.mentorBonus, 800);
    assert.equal(plan.upgradeCredit, 12500);

    const fee = round(plan.price * 0.015);
    const margin = round(plan.price - plan.cogs - plan.shippingCost - fee);
    assert.equal(margin, 4912.5);

    const fullDepth = round(margin * 0.185);
    const net = round(margin - fullDepth - plan.mentorBonus);
    assert.equal(fullDepth, 908.81);
    assert.equal(net, 3203.69);
    assert.ok(net >= 2500, 'the plan must keep a defensible contribution');
  });

  it('anchors display order on Signature and resolves plans by tier and SKU', () => {
    assert.deepEqual(
      STARTER_PRODUCTS.map((plan) => plan.tier),
      ['signature', 'essential'],
    );
    assert.equal(starterProductByTier('essential'), ESSENTIAL_STARTER_PRODUCT);
    assert.equal(starterProductBySku('MS-STARTER-001'), SIGNATURE_STARTER_PRODUCT);
    assert.equal(starterProductByTier('unknown'), null);
  });

  it('prices lifetime upgrades from the current Signature price', () => {
    assert.equal(
      upgradePriceFor({ signaturePrice: 38000, credit: 12500 }),
      25500 + UPGRADE_HANDLING_FEE_NGN,
    );
    assert.equal(
      upgradePriceFor({ signaturePrice: 45000, credit: 12500 }),
      35000,
    );
    assert.equal(
      upgradePriceFor({ signaturePrice: 10000, credit: 12500 }),
      UPGRADE_HANDLING_FEE_NGN,
    );
  });
});
