import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignRoi, flightWindow } from './Marketing.roi.js';

const campaign = {
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  campaignName: 'Test',
  visits: 100,
  budget: { budgetAmount: 20000 },
  adDuration: { campaignStartDate: new Date('2026-01-01'), noEndDate: false, campaignEndDate: new Date('2026-12-31') },
};

describe('buildCampaignRoi', () => {
  it('prices unit costs on full spend: budget + sms + allocation', () => {
    const row = buildCampaignRoi(campaign, { prospects: 10, conversions: 2, worked: 6 }, 'exact', {
      outreachSpend: 1000,
      allocationSpend: 3000,
      allocatedLeads: 10,
    });
    assert.equal(row.allocationSpend, 3000);
    assert.equal(row.allocatedLeads, 10);
    assert.equal(row.windowWorked, 6);
    assert.equal(row.totalSpend, 24000);
    // Not budget-only (2000) — full spend per prospect and conversion.
    assert.equal(row.costPerProspect, 2400);
    assert.equal(row.costPerConversion, 12000);
    assert.equal(row.attribution, 'exact');
  });

  it('stays null-safe with no spend and no prospects', () => {
    const row = buildCampaignRoi({ ...campaign, budget: {} }, { prospects: 0, conversions: 0 }, 'estimated');
    assert.equal(row.allocationSpend, 0);
    assert.equal(row.totalSpend, 0);
    assert.equal(row.costPerProspect, null);
    assert.equal(row.costPerConversion, null);
  });

  it('clips the window to the flight', () => {
    const w = flightWindow(campaign, new Date('2026-06-01'), 30);
    assert.ok(w.start >= new Date('2026-01-01'));
    assert.ok(w.end <= new Date('2026-06-01'));
    const none = flightWindow(campaign, new Date('2027-06-01'), 30);
    assert.equal(none, null);
  });
});
