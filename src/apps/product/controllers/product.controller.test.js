import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { previewProductPricing } from './product.controller.js';

const response = () => ({
  statusCode: 0,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

describe('admin product pricing preview', () => {
  it('returns the documented healthy contribution for the activation product', async () => {
    const res = response();
    await previewProductPricing({
      body: {
        pricingMode: 'direct',
        price: 38000,
        commissionable: true,
        mentorBonus: 1000,
        costBreakdown: {
          manufacturing: 16000,
          lastMileShipping: 3000,
          handling: 2000,
          acquisitionAllowance: 6000,
        },
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.platformContribution, 4604);
    assert.equal(res.body.data.canPublish, true);
  });

  it('reports a loss-making preview without throwing', async () => {
    const res = response();
    await previewProductPricing({
      body: {
        pricingMode: 'direct',
        price: 38000,
        commissionable: true,
        mentorBonus: 1000,
        costBreakdown: {
          manufacturing: 20000,
          lastMileShipping: 3000,
          handling: 2000,
          acquisitionAllowance: 8000,
        },
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.platformContribution, -596);
    assert.equal(res.body.data.canPublish, false);
    assert.equal(res.body.data.status, 'blocked');
  });
});
