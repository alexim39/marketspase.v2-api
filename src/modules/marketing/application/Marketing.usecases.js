import { buildCampaignRoi, flightWindow } from '../domain/Marketing.roi.js';

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

const clampDays = (days) => Math.min(Math.max(Number(days) || 30, 7), 365);

/** Per-campaign ROI: visits + spend + attributed prospects/conversions. */
export class GetCampaignRoiUseCase {
  /** @param {{marketing, outreach?}} deps (outreach adds sms spend per row) */
  constructor({ marketing, outreach = null }) {
    Object.assign(this, { marketing, outreach });
  }

  async execute({ partnerId, days = 30, now = new Date() }) {
    const d = clampDays(days);
    const t = new Date(now);
    const campaigns = await this.marketing.listCampaigns(partnerId);
    const rows = await Promise.all(campaigns.map(async (c) => {
      const window = flightWindow(c, t, d);
      if (!window) return buildCampaignRoi(c, { prospects: 0, conversions: 0 }, 'estimated');
      const exact = await this.marketing.countExactWindow(partnerId, String(c._id), window.start, window.end);
      const outreachSpend = this.outreach
        ? await this.outreach.spendByCampaign(partnerId, String(c._id), window.start, window.end).catch(() => 0)
        : 0;
      // Internal lead spend rides along regardless of attribution branch —
      // money left the wallet whether or not the lead converted yet.
      // Replaced rows were credited back, so they never inflate spend.
      const allocation = this.marketing.allocationSpendWindow
        ? await this.marketing.allocationSpendWindow(partnerId, String(c._id), window.start, window.end).catch(() => ({ spent: 0, leads: 0 }))
        : { spent: 0, leads: 0 };
      const extra = { outreachSpend, allocationSpend: allocation.spent, allocatedLeads: allocation.leads };
      if (exact.prospects > 0) return buildCampaignRoi(c, exact, 'exact', extra);
      const link = await this.marketing.countLinkWindow(partnerId, window.start, window.end);
      return buildCampaignRoi(c, link, 'estimated', extra);
    }));
    const totals = rows.reduce(
      (s, r) => ({
        visits: s.visits + r.visits,
        budget: s.budget + r.budget,
        outreachSpend: s.outreachSpend + (r.outreachSpend ?? 0),
        allocationSpend: s.allocationSpend + (r.allocationSpend ?? 0),
        allocatedLeads: s.allocatedLeads + (r.allocatedLeads ?? 0),
        prospects: s.prospects + r.windowProspects,
        worked: s.worked + (r.windowWorked ?? 0),
        conversions: s.conversions + r.windowConversions,
      }),
      { visits: 0, budget: 0, outreachSpend: 0, allocationSpend: 0, allocatedLeads: 0, prospects: 0, worked: 0, conversions: 0 },
    );
    const fullSpend = totals.budget + totals.outreachSpend + totals.allocationSpend;
    const rate = totals.prospects > 0 ? (totals.conversions / totals.prospects) * 100 : null;
    return {
      days: d,
      campaigns: rows,
      totals: {
        ...totals,
        budget: Math.round(totals.budget * 100) / 100,
        outreachSpend: Math.round(totals.outreachSpend * 100) / 100,
        allocationSpend: Math.round(totals.allocationSpend * 100) / 100,
        conversionRate: rate === null ? null : Math.round(rate * 100) / 100,
        costPerProspect: totals.prospects > 0 && fullSpend > 0
          ? Math.round((fullSpend / totals.prospects) * 100) / 100
          : null,
        costPerConversion: totals.conversions > 0 && fullSpend > 0
          ? Math.round((fullSpend / totals.conversions) * 100) / 100
          : null,
      },
    };
  }
}
