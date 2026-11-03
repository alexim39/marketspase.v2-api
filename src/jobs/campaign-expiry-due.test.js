import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCampaignExpiryDueJob } from './campaign-expiry-due.js';

const oid = (n) => String(n).padStart(24, 'b');

const chain = (rows) => ({
  sort: () => chain(rows),
  limit: () => chain(rows),
  select: () => chain(rows),
  lean: async () => rows,
});

describe('runCampaignExpiryDueJob', () => {
  it('ends past-flight campaigns, notifies, audits; leaves the rest alone', async () => {
    const past = new Date('2026-02-01');
    const rows = [
      { _id: oid(1), campaignName: 'Past flight', createdBy: oid(9), deliveryStatus: 'Active', adDuration: { noEndDate: false, campaignEndDate: past } },
      { _id: oid(2), campaignName: 'Continuous', createdBy: oid(9), deliveryStatus: 'Active', adDuration: { noEndDate: true, campaignEndDate: null } },
      { _id: oid(3), campaignName: 'Future flight', createdBy: oid(9), deliveryStatus: 'Active', adDuration: { noEndDate: false, campaignEndDate: new Date('2027-01-01') } },
      { _id: oid(4), campaignName: 'Already ended', createdBy: oid(9), deliveryStatus: 'Ended', adDuration: { noEndDate: false, campaignEndDate: past } },
    ];
    const notified = [];
    const audited = [];
    const campaigns = {
      find: (q) => chain(rows.filter((r) =>
        r.deliveryStatus === 'Active' &&
        r.adDuration.noEndDate === false &&
        r.adDuration.campaignEndDate < new Date('2026-03-01')
      )),
      findOneAndUpdate: (filter, update) => {
        const row = rows.find((r) => String(r._id) === String(filter._id) && r.deliveryStatus === 'Active');
        if (!row) return { lean: async () => null };
        Object.assign(row, update.$set);
        return { lean: async () => ({ ...row }) };
      },
    };
    const res = await runCampaignExpiryDueJob({
      campaigns,
      notify: async (n) => { notified.push(n); },
      audit: async (a) => { audited.push(a); },
    }, new Date('2026-03-01'));
    assert.equal(res.checked, 1);
    assert.equal(res.ended, 1);
    assert.equal(rows[0].deliveryStatus, 'Ended');
    assert.equal(rows[1].deliveryStatus, 'Active');
    assert.equal(rows[2].deliveryStatus, 'Active');
    assert.deepEqual(notified.map((n) => n.partnerId), [oid(9)]);
    assert.equal(audited[0].action, 'campaign.decide');
    assert.deepEqual(audited[0].detail, { from: 'Active', to: 'Ended', reason: 'flight-ended' });
  });
});
