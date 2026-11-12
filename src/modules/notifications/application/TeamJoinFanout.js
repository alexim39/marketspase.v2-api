import { ACTIVATION_EVENTS } from '../../activation/domain/ActivationEvents.js';
import { buildRecruitAlert } from '../infrastructure/LifecycleMailer.js';

const CAMPAIGN_ALLOCATED = 'partner.allocated';
const CAMPAIGN_OVERRIDDEN = 'campaign.allocation.overridden';

const displayName = (partner, fallback = 'A new partner') => {
  if (!partner) return fallback;
  return [partner.name, partner.surname].filter(Boolean).join(' ')
    || partner.username
    || fallback;
};

const joinKey = ({ source, memberId, allocationId, campaignId }) => {
  if (source === 'referral') return `team-join:referral:${memberId}`;
  const placement = allocationId || `${memberId}:${campaignId || 'campaign'}`;
  return `team-join:${source}:${placement}`;
};

/**
 * Notify a sponsor/owner when a new member joins their downline.
 *
 * Sources:
 * - referral signup → member.signedup (only when member.partnerOf exists)
 * - automatic/manual campaign allocation → partner.allocated
 * - admin placement override → campaign.allocation.overridden
 *
 * Delivery is best-effort and idempotent. In-app notification + forced
 * lifecycle email; push/SMS still follow the partner's preferences.
 */
export class TeamJoinFanoutUseCase {
  constructor({ stored, delivery, partners }) {
    Object.assign(this, { stored, delivery, partners });
  }

  async notifyReferral({ partnerId, memberName = null }) {
    try {
      const member = await this.partners?.findById(partnerId).catch(() => null);
      if (!member) return { status: 'skipped', reason: 'member-not-found' };
      const sponsorId = member.partnerOf ? String(member.partnerOf) : null;
      if (!sponsorId) return { status: 'skipped', reason: 'no-sponsor' };
      return this.notifySponsor({
        sponsorId,
        memberId: partnerId,
        member,
        memberName,
        source: 'referral',
      });
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }

  async notifyAllocation({
    partnerId,
    ownerId = null,
    campaignId = null,
    campaignName = '',
    allocationId = null,
    source = 'allocation',
  }) {
    try {
      const member = await this.partners?.findById(partnerId).catch(() => null);
      if (!member) return { status: 'skipped', reason: 'member-not-found' };
      const sponsorId = ownerId
        ? String(ownerId)
        : (member.partnerOf ? String(member.partnerOf) : null);
      if (!sponsorId) return { status: 'skipped', reason: 'no-sponsor' };
      return this.notifySponsor({
        sponsorId,
        memberId: partnerId,
        member,
        memberName: null,
        source,
        campaignId,
        campaignName,
        allocationId,
      });
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }

  async notifySponsor({
    sponsorId,
    memberId,
    member,
    memberName = null,
    source,
    campaignId = null,
    campaignName = '',
    allocationId = null,
  }) {
    try {
      if (String(sponsorId) === String(memberId)) {
        return { status: 'skipped', reason: 'self' };
      }
      const key = joinKey({ source, memberId, allocationId, campaignId });
      if (await this.stored?.findByKey?.(sponsorId, key).catch(() => null)) {
        return { status: 'skipped', reason: 'already-sent' };
      }
      const sponsor = await this.partners?.findById(sponsorId).catch(() => null);
      if (!sponsor) return { status: 'skipped', reason: 'sponsor-not-found' };
      if (sponsor.suspendedAt) return { status: 'skipped', reason: 'sponsor-suspended' };

      const name = String(memberName ?? '').trim() || displayName(member);
      const sponsorName = displayName(sponsor, 'Partner');
      const referral = source === 'referral';
      const placement = referral
        ? 'signed up through your referral link'
        : source === 'override'
          ? 'was placed in your team by MarketSpase'
          : `was allocated to your team${campaignName ? ` from ${campaignName}` : ''}`;

      const item = {
        category: 'team',
        priority: 'high',
        title: referral ? `${name} joined your team` : `${name} was added to your team`,
        body: `${name} ${placement}. Welcome them today and help them take the first step.`,
        icon: 'person_add',
        link: '/dashboard/team/handoffs',
        key,
      };

      const report = await this.delivery.deliver({
        recipientId: String(sponsorId),
        contact: { email: sponsor.email ?? null, phone: sponsor.phone ?? null },
        item,
        email: buildRecruitAlert({
          memberName: name,
          uplineName: sponsorName,
          source: referral ? 'referral' : 'allocation',
          campaignName,
        }),
        emailPolicy: 'force',
      });

      const reached = report.inApp === 'created'
        || report.inApp === 'deduped'
        || report.email === true;
      return reached
        ? { status: 'notified', emailed: report.email === true, report }
        : { status: 'skipped', reason: 'no-channel', report };
    } catch (error) {
      return { status: 'failed', error: error?.message ?? String(error) };
    }
  }
}

/**
 * @param {{events, stored, delivery, partners}} deps
 * @returns {() => void} unsubscribe for all three sources
 */
export const subscribeTeamJoinFanout = ({ events, stored, delivery, partners }) => {
  const fanout = new TeamJoinFanoutUseCase({ stored, delivery, partners });
  const offs = [
    events.on(ACTIVATION_EVENTS.MEMBER_SIGNED_UP, (payload) => fanout.notifyReferral(payload)),
    events.on(CAMPAIGN_ALLOCATED, (payload) => fanout.notifyAllocation({
      ...payload,
      source: 'allocation',
    })),
    events.on(CAMPAIGN_OVERRIDDEN, (payload) => fanout.notifyAllocation({
      ...payload,
      source: 'override',
    })),
  ];
  return () => offs.forEach((off) => off?.());
};
