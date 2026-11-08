/**
 * Referral summary — the tracked share behind the raw invite link.
 * Link is `c21fg.online/{username}`; recruits counts direct downline;
 * recent lists newest recruits for the dashboard card. No rewards ledger
 * yet — this is attribution visibility, the prerequisite for any program.
 */
export class GetReferralStatsUseCase {
  /** @param {{network, partners}} deps */
  constructor({ network, partners }) {
    Object.assign(this, { network, partners });
  }

  async execute({ partnerId, username, limit = 5 }) {
    const lim = Math.min(Math.max(Number(limit) || 5, 1), 25);
    const [count, recent] = await Promise.all([
      this.network.countChildren(partnerId).catch(() => 0),
      this.network.recentChildren
        ? this.network.recentChildren(partnerId, lim).catch(() => [])
        : Promise.resolve([]),
    ]);
    return {
      link: username ? `https://c21fg.online/${username}` : null,
      recruits: count,
      recent: (recent ?? []).map((r) => ({
        id: String(r._id ?? r.id ?? ''),
        name: [r.name, r.surname].filter(Boolean).join(' ') || r.username,
        username: r.username ?? null,
        createdAt: r.createdAt ?? null,
      })),
    };
  }
}
