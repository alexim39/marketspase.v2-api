import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isManualOverrideActive,
  rankFromJourneyLevel,
  rankLabel,
  shouldAutoSyncRank,
} from './Compensation.rank.js';

describe('commission rank sync rules', () => {
  it('maps journey levels to contract rank labels', () => {
    assert.equal(rankFromJourneyLevel('partner'), 'Partner');
    assert.equal(rankFromJourneyLevel('builder'), 'Builder');
    assert.equal(rankFromJourneyLevel('leader'), 'Leader');
    assert.equal(rankFromJourneyLevel('ambassador'), 'Ambassador');
    assert.equal(rankFromJourneyLevel('unknown'), 'Partner');
    assert.equal(rankLabel('Builder'), 'Builder');
  });

  it('treats a permanent admin override as active', () => {
    const partner = { commissionRankSource: 'admin', commissionRankOverrideUntil: null };
    assert.equal(isManualOverrideActive(partner), true);
    assert.equal(shouldAutoSyncRank(partner), false);
  });

  it('lets an expired admin override fall back to auto', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const partner = {
      commissionRankSource: 'admin',
      commissionRankOverrideUntil: new Date('2026-11-09T12:00:00Z'),
    };
    assert.equal(isManualOverrideActive(partner, now), false);
    assert.equal(shouldAutoSyncRank(partner, now), true);
  });

  it('allows auto sync for auto-ranked partners', () => {
    assert.equal(shouldAutoSyncRank({ commissionRankSource: 'auto' }), true);
  });

  it('does not touch legacy rows until the backfill tags a source', () => {
    assert.equal(isManualOverrideActive({ commissionRank: 'Leader' }), false);
    assert.equal(shouldAutoSyncRank({ commissionRank: 'Leader' }), false);
  });
});
