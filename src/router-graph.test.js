import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Boot guard: every router server.js mounts must import cleanly —
 * a missing export or out-of-scope variable crashes the whole API
 * at startup (nodemon loop), long before any request or unit test
 * touches it. Mirror server.js's router imports here.
 */
const ROUTERS = [
  './modules/audit/index.js',
  './modules/broadcast/index.js',
  './modules/training/index.js',
  './modules/training/interface/AdminTraining.routes.js',
  './modules/identity-access/index.js',
  './modules/onboarding/index.js',
  './modules/campaigns/index.js',
  './modules/compensation/index.js',
  './modules/billing/interface/Billing.routes.js',
  './modules/billing/interface/Deposit.routes.js',
  './modules/crm/interface/Prospect.routes.js',
  './modules/outreach/interface/Outreach.routes.js',
  './modules/broadcast/interface/Broadcast.routes.js',
  './modules/community/interface/Community.routes.js',
  './modules/support-ticketing/index.js',
  './modules/coaching/index.js',
  './modules/marketing/index.js',
  './modules/events/index.js',
  './modules/ora/index.js',
  './modules/settings/index.js',
  './modules/messaging/index.js',
  './modules/progression/index.js',
  './modules/analytics/interface/Analytics.routes.js',
  './modules/dashboard/interface/Dashboard.routes.js',
  './modules/search/index.js',
  './modules/bonuses/index.js',
  './modules/tutorials/index.js',
  './modules/reports/interface/Reports.routes.js',
  './modules/exports/interface/Exports.routes.js',
  './modules/goals/interface/Goals.routes.js',
  './modules/network/interface/Network.routes.js',
  './modules/subscriptions/index.js',
  './apps/product/routes/product.route.js',
  './apps/transaction/routes/transaction.route.js',
  './apps/campaign/routes/campaign.route.js',
  './apps/contact/routes/Contact.routes.js',
  './apps/survey/routes/Survey.routes.js',
  './apps/email-subscription/routes/EmailSubscription.routes.js',
];

describe('router graph', () => {
  for (const mod of ROUTERS) {
    it(`loads ${mod}`, async () => {
      const ns = await import(mod);
      assert.ok(ns, `${mod} exported nothing`);
    });
  }

  it('audit + broadcast expose default routers for server.js', async () => {
    const audit = await import('./modules/audit/index.js');
    const broadcast = await import('./modules/broadcast/index.js');
    assert.equal(typeof audit.default, 'function');
    assert.equal(typeof broadcast.default, 'function');
  });
});
