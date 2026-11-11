import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProductPricing,
  partnerMarginFor,
  platformEconomics,
} from './ProductPricing.js';

const documentedCosts = {
  manufacturing: 16000,
  packaging: 0,
  inboundFreight: 0,
  duties: 0,
  other: 0,
  lastMileShipping: 3000,
  handling: 2000,
  acquisitionAllowance: 6000,
};

describe('product pricing engine', () => {
  it('reproduces the documented activation contribution at ₦38,000', () => {
    const result = computeProductPricing({
      mode: 'direct',
      price: 38000,
      commissionable: true,
      mentorBonus: 1000,
      costBreakdown: documentedCosts,
    });

    assert.equal(result.landedCost, 16000);
    assert.equal(result.totalCostPerUnit, 27000);
    assert.equal(result.commission, 3409.55);
    assert.equal(result.refundReserve, 1140);
    assert.equal(result.rankReserve, 276.45);
    assert.equal(result.platformContribution, 4604);
    assert.equal(result.platformContributionPct, 0.1212);
    assert.equal(result.status, 'healthy');
    assert.equal(result.canPublish, true);
  });

  it('blocks the documented bad case at ₦20,000 COGS and ₦8,000 CAC', () => {
    const result = computeProductPricing({
      mode: 'direct',
      price: 38000,
      commissionable: true,
      mentorBonus: 1000,
      costBreakdown: {
        ...documentedCosts,
        manufacturing: 20000,
        acquisitionAllowance: 8000,
      },
    });

    assert.equal(result.platformContribution, -596);
    assert.equal(result.status, 'blocked');
    assert.equal(result.canPublish, false);
    assert.match(result.reasons.join(' '), /loses money/i);
  });

  it('suggests a partner price and retail price that clear both floors', () => {
    const first = computeProductPricing({
      mode: 'resale',
      price: 30000,
      partnerPrice: 0,
      retailPrice: 0,
      commissionable: true,
      costBreakdown: {
        manufacturing: 10000,
        packaging: 500,
        inboundFreight: 500,
        duties: 500,
        other: 0,
        lastMileShipping: 2000,
        handling: 1000,
        acquisitionAllowance: 0,
      },
    });

    assert.equal(first.status, 'incomplete');
    assert.ok(first.recommendedPartnerPrice > 0);
    assert.ok(first.recommendedRetailPrice > first.recommendedPartnerPrice);

    const second = computeProductPricing({
      mode: 'resale',
      price: 30000,
      partnerPrice: first.recommendedPartnerPrice,
      retailPrice: first.recommendedRetailPrice,
      commissionable: true,
      costBreakdown: {
        manufacturing: 10000,
        packaging: 500,
        inboundFreight: 500,
        duties: 500,
        other: 0,
        lastMileShipping: 2000,
        handling: 1000,
        acquisitionAllowance: 0,
      },
    });

    assert.equal(second.canPublish, true);
    assert.ok(second.platformContributionPct >= 0.05);
    assert.ok(second.partnerMarginPct >= 0.20);
  });

  it('blocks a retail price that leaves the partner below the margin floor', () => {
    const result = computeProductPricing({
      mode: 'resale',
      price: 30000,
      partnerPrice: 20000,
      retailPrice: 23000,
      commissionable: true,
      costBreakdown: {
        manufacturing: 8000,
        lastMileShipping: 1500,
        handling: 500,
      },
    });

    assert.equal(result.partnerMargin, 2540);
    assert.equal(result.partnerMarginPct, 0.1104);
    assert.equal(result.status, 'blocked');
    assert.match(result.reasons.join(' '), /partner margin/i);
  });

  it('treats missing landed cost as incomplete rather than publishable', () => {
    const result = computeProductPricing({
      mode: 'direct',
      price: 38000,
      costBreakdown: {},
    });

    assert.equal(result.status, 'incomplete');
    assert.equal(result.canPublish, false);
    assert.match(result.reasons.join(' '), /manufacturing|landed/i);
  });

  it('removes commission but still reserves fees when not commissionable', () => {
    const commissionable = platformEconomics({
      sellingPrice: 38000,
      costBreakdown: documentedCosts,
      commissionable: true,
      mentorBonus: 1000,
    });
    const plain = platformEconomics({
      sellingPrice: 38000,
      costBreakdown: documentedCosts,
      commissionable: false,
      mentorBonus: 1000,
    });

    assert.equal(plain.commission, 0);
    assert.ok(plain.platformContribution > commissionable.platformContribution);
  });

  it('calculates partner margin after the platform store service fee', () => {
    const margin = partnerMarginFor({
      retailPrice: 50000,
      partnerPrice: 34000,
      storeServiceFeePct: 0.02,
    });

    assert.equal(margin.storeServiceFee, 1000);
    assert.equal(margin.margin, 15000);
    assert.equal(margin.marginPct, 0.3);
  });
});
