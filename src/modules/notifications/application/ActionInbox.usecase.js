import { GetFollowUpRemindersUseCase } from '../../crm/application/Prospect.queries.js';
import { StoreCustomerLeadRepository } from '../../stores/infrastructure/StoreCustomerLead.mongo.repository.js';
import { MongoCampaignRepository } from '../../campaigns/infrastructure/Campaign.mongo.repository.js';
import { GetMyProgressionUseCase } from '../../progression/application/Progression.usecases.js';
import { MongoCompensationRepository } from '../../compensation/infrastructure/Compensation.mongo.repository.js';
import { GetMyCompensationUseCase } from '../../compensation/application/Compensation.usecases.js';

/**
 * Action inbox — a small, resolve-this list derived from live state:
 * follow-ups, reorder-due customers, campaign expiry, rank risk and payout
 * events. Items link straight to the page that resolves them.
 */
export class GetActionInboxUseCase {
  constructor({
    reminders = null,
    customerLeads = new StoreCustomerLeadRepository(),
    campaigns = new MongoCampaignRepository(),
    progression = null,
    compensation = null,
  } = {}) {
    this.reminders = reminders;
    this.customerLeads = customerLeads;
    this.campaigns = campaigns;
    this.progression = progression;
    this.compensation = compensation ?? new GetMyCompensationUseCase({ repo: new MongoCompensationRepository() });
  }

  async execute({ partnerId, now = new Date() } = {}) {
    const [reminders, reorder, campaignRows, journey, comp] = await Promise.all([
      this.reminders ? this.reminders.execute({ partnerId, now }).catch(() => null) : Promise.resolve(null),
      this.customerLeads.list(partnerId, { segment: 'dormant', limit: 5, skip: 0 }).catch(() => null),
      this.campaigns.listMine(partnerId).catch(() => []),
      this.progression ? this.progression.execute({ partnerId, now }).catch(() => null) : Promise.resolve(null),
      this.compensation.execute(partnerId).catch(() => null),
    ]);

    const items = [];
    const push = (item) => {
      if (!item || !item.count || item.count <= 0) return;
      items.push({
        id: item.id,
        category: item.category,
        title: item.title,
        detail: item.detail,
        count: item.count,
        link: item.link,
        actionLabel: item.actionLabel || 'Resolve',
        priority: item.priority || 'normal',
        dueAt: item.dueAt ?? null,
      });
    };

    const followups = Number(reminders?.overdue?.length ?? 0) + Number(reminders?.today?.length ?? 0);
    push({
      id: 'followups',
      category: 'followup',
      title: 'Follow-ups due',
      detail: `${followups} prospect${followups === 1 ? '' : 's'} promised a follow-up. Open the reminder list and clear them.`,
      count: followups,
      link: '/dashboard/prospects/reminders',
      actionLabel: 'Open reminders',
      priority: 'high',
    });

    const dormant = Number(reorder?.total ?? 0);
    push({
      id: 'reorder',
      category: 'reorder',
      title: 'Customers due for a reorder',
      detail: `${dormant} customer${dormant === 1 ? '' : 's'} have not ordered in 60+ days. A consent-based check-in can bring them back.`,
      count: dormant,
      link: '/dashboard/prospects/customer-leads',
      actionLabel: 'Review customers',
      priority: 'high',
    });

    const expiring = (campaignRows ?? []).filter((campaign) => {
      if (campaign.status !== 'Active') return false;
      const endAt = campaign.flight?.endAt ? new Date(campaign.flight.endAt).getTime() : null;
      const endingSoon = endAt !== null && endAt - now.getTime() <= 7 * 86400000;
      const lowBudget = Number(campaign.budget?.remaining ?? 0) <= 1100;
      return endingSoon || lowBudget;
    });
    push({
      id: 'campaign-expiry',
      category: 'campaign',
      title: 'Campaigns nearing their end',
      detail: `${expiring.length} campaign${expiring.length === 1 ? '' : 's'} are ending soon or low on budget. Review ROI before funding again.`,
      count: expiring.length,
      link: '/dashboard/campaigns',
      actionLabel: 'Review campaigns',
      priority: 'normal',
    });

    const rankRisk = journey && (journey.forecast?.stalled === true || (journey.next && Number(journey.percent ?? 0) < 40));
    push({
      id: 'rank-risk',
      category: 'rank',
      title: 'Rank progress needs attention',
      detail: 'Your next rank has stalled or is below 40%. Open your progress and pick one qualifying action.',
      count: rankRisk ? 1 : 0,
      link: '/dashboard/progress',
      actionLabel: 'Open progress',
      priority: 'normal',
    });

    const pendingPayout = Number(comp?.summary?.pending ?? 0) > 0;
    const scheduledBonus = (comp?.mentorBonuses ?? []).filter((bonus) => bonus.status === 'scheduled');
    push({
      id: 'payout',
      category: 'payout',
      title: 'Payout events to review',
      detail: pendingPayout
        ? `₦${Number(comp.summary.pending).toLocaleString('en-NG')} is pending release. Check the ledger for the source and status.`
        : 'A mentor bonus is scheduled. Check its due date and status.',
      count: pendingPayout ? 1 : scheduledBonus.length,
      link: '/dashboard/compensation',
      actionLabel: 'Open earnings',
      priority: pendingPayout ? 'normal' : 'low',
    });

    const order = { critical: 0, high: 1, normal: 2, low: 3 };
    items.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
    return { items, total: items.length, generatedAt: new Date().toISOString() };
  }
}
