import { RANKS, rankDepth } from '../../compensation/domain/Compensation.plan.js';
import { buildProspectNotifications } from '../../crm/domain/Prospect.notifications.js';
import { buildOraOpportunities } from '../domain/Ora.opportunities.js';
import { lagosDateKey } from '../domain/Ora.plans.js';

/**
 * Ora context assembler — one bounded live snapshot per chat call.
 * Every source is best-effort: a failing slice degrades to an empty
 * section, never to a failed chat. Budgets are hard (token/cost control):
 * 200 prospects scanned, 5 names/events/goals max in the prompt.
 */

const PROSPECT_SCAN_LIMIT = 200;
const MAX_NAMES = 5;
const MAX_EVENTS = 5;
const MAX_GOALS = 4;

const asDate = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const safe = (value) => Promise.resolve(value).catch(() => null);

const fmtDay = (v) => {
  const d = asDate(v);
  return d ? d.toISOString().slice(0, 10) : 'soon';
};

const doneMilestone = (value) => value === true || value?.done === true;

const journeyStageOf = ({ accountState, emailVerified, kycStatus, activationOrder, commissionRank }) => {
  if (accountState === 'member') {
    if (emailVerified === false) return 'new_member';
    if (kycStatus === 'rejected') return 'kyc_rejected';
    if (kycStatus === 'pending') return 'kyc_pending';
    if (activationOrder && ['Pending', 'Paid'].includes(String(activationOrder.status))) return 'pre_activation';
    return 'member';
  }
  const rank = String(commissionRank ?? 'Partner');
  return ['Builder', 'Leader', 'Ambassador'].includes(rank) ? rank.toLowerCase() : 'partner';
};

export class OraContextAssembler {
  /** @param {{goals, prospects, events, notifications, partners}} deps */
  constructor(deps = {}) {
    Object.assign(this, deps);
  }

  /**
   * @param {{partnerId, now}} input
   * @returns bounded snapshot for the persona prompt (never throws).
   */
  async assemble({ partnerId, now = new Date() } = {}) {
    const ctx = {
      displayName: 'there',
      accountState: 'member',
      journeyStage: 'member',
      emailVerified: true,
      kycStatus: 'not_started',
      activatedAt: null,
      activationOrder: null,
      queue: null,
      sponsor: null,
      mentorContactPreference: 'in_app',
      mentorContactConsentAt: null,
      commissionRank: 'Partner',
      commissionDepth: 1,
      placed: null,
      level: 'Partner',
      levelLabel: 'Partner',
      next: 'Builder',
      nextLabel: 'Builder',
      nextRank: null,
      percent: 0,
      missing: [],
      training: { ipo: false, qsg: false, smo: false, leadership: false },
      nextActions: [],
      prospects: { total: 0, overdue: [], hot: [] },
      pipeline: { total: 0, overdue: 0, hot: 0, byStage: {} },
      walletBalance: 0,
      team: { directPartners: 0, activated: 0, members: 0, stuck: 0, recent: [] },
      campaigns: { total: 0, active: 0, pending: 0, remainingBudget: 0, items: [] },
      store: null,
      plan: { dateKey: lagosDateKey(now), items: [], source: null, savedAt: null },
      opportunities: [],
      goals: [],
      events: [],
      unread: 0,
    };
    const [prospects, goals, events, unread, partner, myCampaigns, myStore, storeOrders, todayPlan, journeyState, activation, teamActivation] = await Promise.all([
      safe(this.prospects?.findByPartnerId(partnerId, { limit: PROSPECT_SCAN_LIMIT, skip: 0 })),
      safe(this.goals?.execute({ partnerId, now })),
      safe(this.events?.execute({ viewerId: partnerId, limit: MAX_EVENTS })),
      safe(this.notifications?.unreadCount(partnerId)),
      safe(this.partners?.findById(partnerId)),
      safe(this.campaigns?.listMine(partnerId)),
      safe(this.store?.getMyStore(partnerId)),
      safe(this.storeOrders?.listPartnerOrders(partnerId, { limit: 5 })),
      safe(this.plans?.get(partnerId, lagosDateKey(now))),
      safe(this.journey?.execute?.({ partnerId, now, readOnly: true })),
      safe(this.onboarding?.getStatus?.(partnerId)),
      safe(this.network?.teamActivation?.(partnerId, { limit: 5, now })),
    ]);
    let fallbackTeamCount = 0;
    let fallbackTeamRecent = [];
    if (!teamActivation) {
      [fallbackTeamCount, fallbackTeamRecent] = await Promise.all([
        safe(this.network?.countChildren(partnerId)),
        safe(this.network?.recentChildren(partnerId, 3)),
      ]);
    }

    if (partner) {
      const rank = RANKS.includes(partner.commissionRank) ? partner.commissionRank : 'Partner';
      const index = RANKS.indexOf(rank);
      ctx.commissionRank = rank;
      ctx.commissionDepth = rankDepth(rank);
      ctx.placed = !!partner.partnerOf;
      ctx.level = rank;
      ctx.levelLabel = rank;
      ctx.next = RANKS[index + 1] ?? null;
      ctx.nextLabel = ctx.next;
      const full = [partner.name, partner.surname].filter(Boolean).join(' ').trim();
      ctx.displayName = full || partner.username || 'there';
      ctx.walletBalance = Number(partner.balance ?? 0);
    }

    const activationPartner = activation?.partner ?? null;
    ctx.accountState = activationPartner?.accountState === 'member' || partner?.accountState === 'member'
      ? 'member'
      : 'partner';
    ctx.emailVerified = activationPartner?.emailVerified ?? partner?.emailVerified ?? true;
    ctx.kycStatus = activationPartner?.kycStatus ?? partner?.kycStatus ?? 'not_started';
    ctx.activatedAt = activationPartner?.activatedAt ?? partner?.activatedAt ?? null;
    ctx.activationOrder = activation?.activationOrder ?? null;
    ctx.queue = activation?.queue ?? null;
    ctx.sponsor = activation?.sponsor ?? null;
    ctx.mentorContactPreference = activationPartner?.mentorContactPreference
      ?? partner?.mentorContactPreference
      ?? 'in_app';
    ctx.mentorContactConsentAt = activationPartner?.mentorContactConsentAt
      ?? partner?.mentorContactConsentAt
      ?? null;
    if (journeyState) {
      ctx.percent = Number(journeyState.percent) || 0;
      ctx.next = journeyState.next ?? ctx.next;
      ctx.nextLabel = journeyState.nextLabel ?? ctx.nextLabel;
      ctx.nextRank = journeyState.nextLabel ?? journeyState.next ?? ctx.nextRank;
      ctx.missing = (journeyState.missing ?? [])
        .map((item) => String(item?.title ?? item))
        .slice(0, 5);
      const milestones = journeyState.milestones ?? {};
      ctx.training = {
        ipo: doneMilestone(milestones.ipo),
        qsg: doneMilestone(milestones.qsg),
        smo: doneMilestone(milestones.smo),
        leadership: doneMilestone(milestones.leadership),
      };
    }
    ctx.journeyStage = journeyStageOf({
      accountState: ctx.accountState,
      emailVerified: ctx.emailVerified,
      kycStatus: ctx.kycStatus,
      activationOrder: ctx.activationOrder,
      commissionRank: ctx.commissionRank,
    });
    const list = prospects?.items ?? [];
    if (list.length > 0) {
      const byId = new Map(list.map((p) => [String(p.id ?? p._id), p]));
      const nameOf = (id) => {
        const p = byId.get(String(id));
        const full = p ? `${p.prospectName ?? ''} ${p.prospectSurname ?? ''}`.trim() : '';
        return full || 'a prospect';
      };
      const notes = buildProspectNotifications(list, now);
      ctx.prospects = {
        total: prospects?.total ?? list.length,
        overdue: [...new Set(
          notes.filter((x) => x.urgency === true).map((x) => nameOf(x.prospectId)),
        )].slice(0, MAX_NAMES),
        hot: [...new Set(
          notes.filter((x) => x.tag === 'Hot Lead').map((x) => nameOf(x.prospectId)),
        )].slice(0, MAX_NAMES),
      };
    }
    ctx.goals = (goals ?? [])
      .filter((g) => g?.progress && !g.progress.complete)
      .slice(0, MAX_GOALS)
      .map((g) => ({
        title: String(g.title ?? g.kind ?? 'Goal').slice(0, 60),
        percent: g.progress.percent ?? 0,
        onTrack: g.progress.onTrack !== false,
        daysLeft: g.progress.daysLeft ?? 0,
      }));
    ctx.events = ((events?.items ?? []).slice(0, MAX_EVENTS)).map((e) => ({
      title: String(e.title ?? 'Community event').slice(0, 80),
      startsAt: fmtDay(e.startsAt),
      location: String(e.location ?? '').slice(0, 60) || null,
    }));
    ctx.unread = Number(unread) || 0;
    if (teamActivation) {
      ctx.team = {
        ...teamActivation,
        directPartners: Number(teamActivation.total) || 0,
      };
    } else {
      ctx.team = {
        directPartners: Number(fallbackTeamCount) || 0,
        activated: 0,
        members: 0,
        stuck: 0,
        inactive: 0,
        recent: (fallbackTeamRecent ?? []).slice(0, 3).map((p) => ({
          name: [p.name, p.surname].filter(Boolean).join(' ') || p.username || 'Partner',
          username: p.username ?? '',
          accountState: p.accountState === 'member' ? 'member' : 'partner',
          kycStatus: p.kycStatus ?? 'not_started',
          rank: p.commissionRank ?? 'Partner',
        })),
      };
    }
    const campaignRows = Array.isArray(myCampaigns) ? myCampaigns : [];
    ctx.campaigns = {
      total: campaignRows.length,
      active: campaignRows.filter((c) => c.status === 'Active').length,
      pending: campaignRows.filter((c) => c.status === 'Pending').length,
      remainingBudget: Math.round(campaignRows.reduce((sum, c) => sum + Number(c.budget?.remaining ?? 0), 0) * 100) / 100,
      items: campaignRows.slice(0, 3).map((c) => ({
        name: String(c.name ?? 'Campaign').slice(0, 60),
        status: c.status,
        remaining: Number(c.budget?.remaining ?? 0),
        allocated: Number(c.capacity?.allocated ?? 0),
        capacity: Number(c.capacity?.total ?? 0),
      })),
    };
    if (myStore?.store || myStore?.counts) {
      const orders = Array.isArray(storeOrders) ? storeOrders : [];
      const openOrders = orders.filter((o) => ['paid', 'processing', 'shipped'].includes(String(o.status ?? '')));
      ctx.store = {
        slug: myStore?.store?.slug ?? '',
        name: myStore?.store?.name ?? '',
        status: myStore?.store?.status ?? 'draft',
        published: Number(myStore?.counts?.published ?? 0),
        draft: Number(myStore?.counts?.draft ?? 0),
        pendingReceipts: Number(myStore?.counts?.pendingReceipts ?? 0),
        openOrders: openOrders.length,
        recentOrders: orders.slice(0, 3).map((o) => ({
          orderNumber: o.orderNumber ?? '',
          status: o.status ?? '',
        })),
      };
    }
    if (todayPlan) {
      ctx.plan = {
        dateKey: todayPlan.dateKey ?? lagosDateKey(now),
        items: (todayPlan.items ?? []).slice(0, 3),
        source: todayPlan.source ?? null,
        savedAt: todayPlan.savedAt ?? null,
      };
    }
    ctx.pipeline = {
      total: Number(prospects?.total ?? list.length) || 0,
      overdue: 0,
      hot: 0,
      byStage: {},
    };
    if (list.length > 0) {
      const noteRows = buildProspectNotifications(list, now);
      ctx.pipeline.overdue = noteRows.filter((x) => x.urgency === true).length;
      ctx.pipeline.hot = noteRows.filter((x) => x.tag === 'Hot Lead').length;
      for (const prospect of list) {
        const stage = String(prospect?.status?.stage ?? 'New');
        ctx.pipeline.byStage[stage] = (ctx.pipeline.byStage[stage] ?? 0) + 1;
      }
    }
    ctx.opportunities = buildOraOpportunities({
      prospects,
      goals,
      events,
      unread: ctx.unread,
      partner,
      team: ctx.team,
      campaigns: ctx.campaigns,
      store: ctx.store,
      plan: ctx.plan,
      now,
    });
    return ctx;
  }
}
