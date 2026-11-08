/**
 * Single source of truth for what a partner account may do.
 *
 * Legacy rows predate `accountState` / `kycStatus`; missing values mean an
 * active, verified partner so old accounts keep working. Every API gate and
 * the `/v1/auth/me` payload use this policy so activation, campaigns, stores,
 * resale and commissions can never disagree.
 */
export const partnerCapabilities = (partner = {}) => {
  if (!partner || typeof partner !== 'object') {
    return {
      accountState: 'member',
      kycStatus: 'not_started',
      activated: false,
      kycVerified: false,
      suspended: false,
      canActivate: false,
      canFundCampaign: false,
      canOpenStore: false,
      canBuyResale: false,
      canReceiveCommissions: false,
      canUsePartnerWorkspace: false,
    };
  }
  const suspended = Boolean(partner?.suspendedAt);
  const accountState = partner?.accountState === 'member' ? 'member' : 'partner';
  const kycStatus = partner?.kycStatus ?? 'verified';
  const activated = accountState === 'partner';
  const kycVerified = kycStatus === 'verified';
  const activePartner = activated && !suspended;

  return {
    accountState,
    kycStatus,
    activated,
    kycVerified,
    suspended,
    /** Member may buy the starter product only after identity is verified. */
    canActivate: accountState === 'member' && !suspended && kycVerified,
    /** Partner money-and-channel surfaces require active + verified. */
    canFundCampaign: activePartner && kycVerified,
    canOpenStore: activePartner && kycVerified,
    canBuyResale: activePartner && kycVerified,
    canReceiveCommissions: activePartner && kycVerified,
    /** Messaging, community and learning are open to unactivated members. */
    canUsePartnerWorkspace: !suspended,
  };
};

export const hasCapability = (partner, capability) => (
  partnerCapabilities(partner)[capability] === true
);
