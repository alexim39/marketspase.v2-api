import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { partnerCapabilities } from './PartnerCapabilities.js';

describe('partnerCapabilities', () => {
  it('keeps legacy accounts active and verified when fields are missing', () => {
    const caps = partnerCapabilities({});
    assert.equal(caps.accountState, 'partner');
    assert.equal(caps.kycVerified, true);
    assert.equal(caps.canFundCampaign, true);
    assert.equal(caps.canOpenStore, true);
    assert.equal(caps.canBuyResale, true);
  });

  it('does not let a member activate until identity is verified', () => {
    const pending = partnerCapabilities({ accountState: 'member', kycStatus: 'pending' });
    assert.equal(pending.canActivate, false);
    assert.equal(pending.canOpenStore, false);
    assert.equal(pending.canFundCampaign, false);

    const verified = partnerCapabilities({ accountState: 'member', kycStatus: 'verified' });
    assert.equal(verified.canActivate, true);
    assert.equal(verified.canOpenStore, false, 'activation still required first');
  });

  it('requires both activation and verification for money surfaces', () => {
    assert.equal(partnerCapabilities({ accountState: 'partner', kycStatus: 'pending' }).canFundCampaign, false);
    assert.equal(partnerCapabilities({ accountState: 'member', kycStatus: 'verified' }).canBuyResale, false);
    assert.equal(partnerCapabilities({ accountState: 'partner', kycStatus: 'verified' }).canFundCampaign, true);
  });

  it('blocks every partner surface when suspended', () => {
    const caps = partnerCapabilities({ accountState: 'partner', kycStatus: 'verified', suspendedAt: new Date() });
    assert.equal(caps.suspended, true);
    assert.equal(caps.canFundCampaign, false);
    assert.equal(caps.canOpenStore, false);
    assert.equal(caps.canBuyResale, false);
    assert.equal(caps.canReceiveCommissions, false);
  });
});
