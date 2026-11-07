import { bucketFollowUps } from '../../crm/domain/Prospect.reminders.js';
import { buildProspectNotifications } from '../../crm/domain/Prospect.notifications.js';
import { hasAutomationConsent } from './Ora.consent.js';

/**
 * Ora opportunities — a bounded, server-generated list of safe next moves.
 *
 * The model may reference only these IDs in its action block. Live contact
 * details never enter the prompt; the executor re-loads the prospect and
 * re-checks ownership + consent before any send.
 */
const MAX_OPPORTUNITIES = 8;
const MAX_PIPELINE = 3;

const firstNameOf = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'there';

const smsDraft = (name) => `Hi ${firstNameOf(name)}, just checking in on our last conversation. Is this still something you'd like to explore? I can share the next step whenever you're ready.`;

const emailDraft = (name) => ({
  subject: `Checking in, ${firstNameOf(name)}`,
  body: `Hi ${firstNameOf(name)},\n\nI wanted to check in on our last conversation. If you're still interested, I can share the next step whenever you're ready.\n\nNo pressure either way.`,
});

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
    const consent = hasAutomationConsent(prospect);
    const phone = String(prospect.prospectPhone ?? '').trim();
    const email = String(prospect.prospectEmail ?? '').trim();
    seenProspects.add(id);

    if (consent && phone) {
      opportunities.push({
        id: `opp:followup:${id}`,
        type: 'send_sms',
        area: 'Pipeline',
        title: `Follow up with ${name}`,
        reason,
        page: '/dashboard/prospects/pipeline',
        capabilityKey: 'pipeline.followups',
        prospectId: id,
        prospectName: name,
        contactChannel: 'phone',
        requiresApproval: true,
        payload: { prospectId: id, body: smsDraft(name) },
        summary: hot ? 'Hot lead · short SMS ready' : 'Short check-in SMS ready',
      });
      return true;
    }
    if (consent && email) {
      const draft = emailDraft(name);
      opportunities.push({
        id: `opp:followup:${id}`,
        type: 'send_email',
        area: 'Pipeline',
        title: `Email ${name}`,
        reason,
        page: '/dashboard/prospects/pipeline',
        capabilityKey: 'pipeline.followups',
        prospectId: id,
        prospectName: name,
        contactChannel: 'email',
        requiresApproval: true,
        payload: { prospectId: id, ...draft },
        summary: hot ? 'Hot lead · email draft ready' : 'Check-in email draft ready',
      });
      return true;
    }
    opportunities.push(openPage({
      id: `opp:review:${id}`,
      page: '/dashboard/prospects/pipeline',
      capabilityKey: 'pipeline.followups',
      area: 'Pipeline',
      title: `Review ${name}`,
      reason: consent
        ? `${reason} · no phone or email on file`
        : `${reason} · consent not recorded, so no automated send`,
      prospectId: id,
      prospectName: name,
    }));
    return true;
  };

  const buckets = bucketFollowUps(items, now);
  for (const entry of [...buckets.overdue, ...buckets.today].slice(0, MAX_PIPELINE)) {
    pushProspect(
      entry.prospectId,
      entry.daysOverdue > 0 ? `Follow-up overdue by ${entry.daysOverdue} day(s)` : 'Follow-up is due today',
    );
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

  if (['Leader', 'Ambassador'].includes(String(partner?.commissionRank ?? ''))) {
    opportunities.push(openPage({
      id: 'opp:team',
      page: '/dashboard/team',
      capabilityKey: 'team.hub',
      area: 'Team',
      title: 'Review your team pulse',
      reason: 'Leadership rank — check who needs support this week',
    }));
  }

  return opportunities.slice(0, MAX_OPPORTUNITIES);
};
