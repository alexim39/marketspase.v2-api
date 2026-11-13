import { bucketFollowUps } from '../../crm/domain/Prospect.reminders.js';
import { buildProspectNotifications } from '../../crm/domain/Prospect.notifications.js';
import { lagosDateKey } from './Ora.plans.js';

/**
 * Ora opportunities — a bounded, server-generated list of safe next moves.
 *
 * The model may reference only these IDs in its action block. Live contact
 * details never enter the prompt; the executor re-loads the prospect and
 * re-checks ownership + consent before any send.
 */
const MAX_OPPORTUNITIES = 8;
const MAX_PIPELINE = 3;

const openPage = ({ id, page, capabilityKey, area, title, reason, prospectId = null, prospectName = null }) => ({
  id,
  type: 'open_page',
  area,
  title,
  reason,
  page,
  capabilityKey,
  prospectId,
  prospectName,
  requiresApproval: false,
  payload: {},
});

export const buildOraOpportunities = ({
  prospects = null,
  goals = [],
  events = null,
  unread = 0,
  partner = null,
  team = null,
  campaigns = null,
  store = null,
  plan = null,
  now = new Date(),
} = {}) => {
  const items = prospects?.items ?? [];
  const byId = new Map(items.map((p) => [String(p.id ?? p._id), p]));
  const opportunities = [];
  const seenProspects = new Set();

  const pushProspect = (prospectId, reason, { hot = false } = {}) => {
    const id = String(prospectId ?? '');
    if (!id || seenProspects.has(id)) return false;
    const prospect = byId.get(id);
    if (!prospect) return false;
    const stage = prospect.status?.stage;
    if (stage === 'Closed' || stage === 'Converted' || prospect.status?.status === 'Closed') return false;
    const name = `${prospect.prospectName ?? ''} ${prospect.prospectSurname ?? ''}`.trim() || 'this prospect';
    seenProspects.add(id);

    opportunities.push(openPage({
      id: `opp:review:${id}`,
      page: '/dashboard/prospects/pipeline',
      capabilityKey: 'pipeline.followups',
      area: 'Pipeline',
      title: `Follow up with ${name}`,
      reason,
      prospectId: id,
      prospectName: name,
      summary: hot ? 'Hot lead · open the record' : 'Open the record to follow up',
    }));
    return true;
  };

  /**
   * A consenting prospect can receive an approved message. The executor
   * re-checks ownership, consent and contact details before sending.
   */
  const pushMessage = (prospectId, reason) => {
    const id = String(prospectId ?? '');
    if (!id || seenProspects.has(id)) return false;
    const prospect = byId.get(id);
    if (!prospect || prospect.consentToContact !== true) return false;
    const stage = prospect.status?.stage;
    if (stage === 'Closed' || stage === 'Converted' || prospect.status?.status === 'Closed') return false;
    const phone = String(prospect.prospectPhone ?? '').trim();
    const email = String(prospect.prospectEmail ?? '').trim();
    if (!phone && !email) return false;
    const name = `${prospect.prospectName ?? ''} ${prospect.prospectSurname ?? ''}`.trim() || 'this prospect';
    const firstName = name.split(/\s+/)[0] || name;
    seenProspects.add(id);

    opportunities.push({
      id: `opp:message:${id}`,
      type: 'send_followup',
      area: 'Pipeline',
      title: `Send ${name} a follow-up`,
      reason,
      page: '/dashboard/prospects/pipeline',
      capabilityKey: 'pipeline.followups',
      prospectId: id,
      prospectName: name,
      requiresApproval: true,
      payload: {
        prospectId: id,
        prospectName: name,
        channel: phone ? 'sms' : 'email',
        subject: `Following up with ${name}`,
        body: `Hi ${firstName}, just checking in to see how things are going. Is there a good time this week to connect?`,
      },
      summary: phone ? 'SMS draft ready for your approval' : 'Email draft ready for your approval',
    });
    return true;
  };

  const buckets = bucketFollowUps(items, now);
  let messageQueued = false;
  for (const entry of [...buckets.overdue, ...buckets.today].slice(0, MAX_PIPELINE)) {
    const reason = entry.daysOverdue > 0 ? `Follow-up overdue by ${entry.daysOverdue} day(s)` : 'Follow-up is due today';
    if (!messageQueued && entry.daysOverdue > 0 && pushMessage(entry.prospectId, reason)) {
      messageQueued = true;
    } else {
      pushProspect(entry.prospectId, reason);
    }
    if (opportunities.length >= MAX_PIPELINE) break;
  }

  if (opportunities.length < MAX_PIPELINE) {
    const notes = buildProspectNotifications(items, now);
    for (const note of notes) {
      if (note.tag !== 'Hot Lead') continue;
      if (pushProspect(note.prospectId, 'Hot lead from your last conversation', { hot: true })) {
        if (opportunities.length >= MAX_PIPELINE) break;
      }
    }
  }

  const risk = (goals ?? []).find((g) => g?.progress && !g.progress.complete && g.progress.onTrack === false);
  if (risk) {
    opportunities.push(openPage({
      id: `opp:goal:${String(risk.id ?? risk._id ?? risk.title)}`,
      page: '/dashboard/goals',
      capabilityKey: 'learn.goals',
      area: 'Learn',
      title: `Review at-risk goal "${String(risk.title ?? 'Goal').slice(0, 60)}"`,
      reason: `${risk.progress.percent ?? 0}% with ${risk.progress.daysLeft ?? 0} day(s) left`,
    }));
  }

  if (Number(unread) > 0) {
    opportunities.push(openPage({
      id: 'opp:notifications',
      page: '/dashboard/notifications/center',
      capabilityKey: 'notifications.center',
      area: 'Notifications',
      title: 'Review unread notifications',
      reason: `${Number(unread)} unread item(s)`,
    }));
  }

  const nextEvent = (events?.items ?? [])[0];
  if (nextEvent) {
    opportunities.push(openPage({
      id: `opp:event:${String(nextEvent.id ?? nextEvent.title)}`,
      page: '/dashboard/community/events',
      capabilityKey: 'community.events',
      area: 'Community',
      title: `Prepare for ${String(nextEvent.title ?? 'the next event').slice(0, 60)}`,
      reason: nextEvent.startsAt ? `Starts ${new Date(nextEvent.startsAt).toISOString().slice(0, 10)}` : 'Upcoming event',
    }));
  }

  if (partner && Number(partner.balance ?? 0) < 500) {
    opportunities.push(openPage({
      id: 'opp:wallet',
      page: '/dashboard/settings/billing',
      capabilityKey: 'wallet.billing',
      area: 'Wallet',
      title: 'Check your wallet before sending SMS',
      reason: `Balance is ₦${Number(partner.balance ?? 0).toLocaleString('en-NG')}`,
    }));
  }

  if (campaigns && Number(campaigns.pending ?? 0) > 0) {
    opportunities.push(openPage({
      id: 'opp:campaign:pending',
      page: '/dashboard/campaigns',
      capabilityKey: 'campaigns.fund',
      area: 'Campaigns',
      title: 'Review your pending acquisition campaign',
      reason: `${campaigns.pending} campaign(s) waiting for funding or approval`,
    }));
  }

  if (team && Number(team.directPartners ?? 0) > 0) {
    opportunities.push(openPage({
      id: 'opp:team',
      page: '/dashboard/team',
      capabilityKey: 'team.hub',
      area: 'Team',
      title: 'Review your team pulse',
      reason: `${team.directPartners} direct partner(s) in your team`,
    }));
  }

  if (store && Number(store.pendingReceipts ?? 0) > 0) {
    opportunities.push(openPage({
      id: 'opp:store:receipts',
      page: '/dashboard/products/store-orders',
      capabilityKey: 'products.store-orders',
      area: 'Products',
      title: 'Confirm store receipts',
      reason: `${store.pendingReceipts} wholesale receipt(s) waiting`,
    }));
  } else if (store && Number(store.openOrders ?? 0) > 0) {
    opportunities.push(openPage({
      id: 'opp:store:orders',
      page: '/dashboard/products/store-orders',
      capabilityKey: 'products.store-orders',
      area: 'Products',
      title: 'Fulfil open store orders',
      reason: `${store.openOrders} order(s) need attention`,
    }));
  }

  if (['Leader', 'Ambassador'].includes(String(partner?.commissionRank ?? '')) && !team?.directPartners) {
    opportunities.push(openPage({
      id: 'opp:team:leadership',
      page: '/dashboard/team',
      capabilityKey: 'team.hub',
      area: 'Team',
      title: 'Review your leadership team',
      reason: 'Leadership rank — check who needs support this week',
    }));
  }

  const existingPlanItems = Array.isArray(plan?.items)
    ? plan.items
      .filter((item) => item && String(item.title ?? '').trim())
      .slice(0, 3)
      .map((item) => ({
        title: String(item.title).trim().slice(0, 100),
        ...(item.detail ? { detail: String(item.detail).trim().slice(0, 240) } : {}),
        ...(item.link ? { link: String(item.link).trim().slice(0, 200) } : {}),
      }))
    : [];
  const basePlanItems = existingPlanItems.length > 0
    ? existingPlanItems
    : opportunities
      .filter((item) => item?.title)
      .slice(0, 3)
      .map((item) => ({
        title: String(item.title).trim().slice(0, 100),
        ...(item.summary || item.reason
          ? { detail: String(item.summary ?? item.reason).trim().slice(0, 240) }
          : {}),
        ...(String(item.page ?? '').startsWith('/dashboard') ? { link: item.page } : {}),
      }));
  const suggestedItems = basePlanItems.length > 0 ? basePlanItems : [
    { title: 'Review your pipeline', detail: 'Find one person to follow up with today', link: '/dashboard/pipeline' },
    { title: 'Check your goals', detail: 'Pick the next step toward your target', link: '/dashboard/goals' },
  ];

  opportunities.unshift({
    id: 'opp:plan:today',
    type: 'save_daily_plan',
    area: 'Home',
    title: existingPlanItems.length > 0 ? "Update today's plan" : "Save today's plan",
    reason: existingPlanItems.length > 0
      ? 'Adjust the focus you already saved for today'
      : "Turn today's priorities into a plan you can follow",
    page: '/dashboard/ora',
    capabilityKey: 'home.plan',
    requiresApproval: true,
    payload: { dateKey: lagosDateKey(now), items: suggestedItems },
    summary: existingPlanItems.length > 0
      ? 'Your saved plan can be edited'
      : `${suggestedItems.length} focus item(s) ready`,
  });

  return opportunities.slice(0, MAX_OPPORTUNITIES);
};
