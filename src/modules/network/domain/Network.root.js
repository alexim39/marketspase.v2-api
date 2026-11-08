/**
 * Virtual, non-earning system root.
 *
 * MarketSpase is the structural root of every network. It is NOT a partner
 * record: it has no login, wallet, KYC, rank, store or commission entitlement.
 * APIs expose it as read-only metadata so tree/org views can show the root
 * without affecting member counts, commission walks or mentor bonuses.
 */
export const SYSTEM_ROOT = Object.freeze({
  id: 'system-root',
  username: 'marketspase',
  name: 'MarketSpase',
  surname: 'Root',
  role: 'system',
  plan: 'root',
  commissionRank: null,
  commissionDepth: 0,
  relationType: null,
  profileImage: null,
  childCount: 0,
  truncated: false,
  systemRoot: true,
  earning: false,
});
