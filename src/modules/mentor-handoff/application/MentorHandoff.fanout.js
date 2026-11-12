import { ACTIVATION_EVENTS } from '../../activation/domain/ActivationEvents.js';

const CAMPAIGN_ALLOCATED = 'partner.allocated';
const CAMPAIGN_OVERRIDDEN = 'campaign.allocation.overridden';
const PARTNER_ACTIVATED = 'partner.activated';

/**
 * Creates/updates the mentor's new-member task from the same facts that power
 * joining and activation. The task is created at join; the activation event
 * supplies the member's consent preference once they activate.
 */
export class MentorHandoffFanoutUseCase {
  constructor({ handoffs, partners }) {
    Object.assign(this, { handoffs, partners });
  }

  async ensureForMember({ partnerId, mentorId = null, source = 'referral', joinedAt = null }) {
    const member = await this.partners.findById(partnerId).catch(() => null);
    if (!member) return { status: 'skipped', reason: 'member-not-found' };
    const ownerId = mentorId
      ? String(mentorId)
      : (member.partnerOf ? String(member.partnerOf) : null);
    if (!ownerId) return { status: 'skipped', reason: 'no-mentor' };
    const task = await this.handoffs.ensureTask({
      partnerId,
      mentorId: ownerId,
      source,
      joinedAt: joinedAt ?? member.createdAt ?? new Date(),
      preference: member.mentorContactPreference ?? 'in_app',
      consentAt: member.mentorContactConsentAt ?? null,
    });
    return { status: 'created', task };
  }

  async onReferral(payload) {
    return this.ensureForMember({
      partnerId: payload?.partnerId,
      source: 'referral',
    });
  }

  async onAllocated(payload, source = 'allocation') {
    const partnerId = payload?.partnerId;
    return this.ensureForMember({
      partnerId,
      mentorId: payload?.ownerId ?? null,
      source,
      joinedAt: new Date(),
    });
  }

  async onActivated(payload) {
    const partnerId = payload?.partnerId;
    if (!partnerId) return { status: 'skipped', reason: 'no-partner' };
    const member = await this.partners.findById(partnerId).catch(() => null);
    if (!member) return { status: 'skipped', reason: 'member-not-found' };
    const preference = payload?.mentorContactPreference ?? member.mentorContactPreference ?? 'in_app';
    const consentAt = payload?.mentorContactConsentAt ?? member.mentorContactConsentAt ?? null;
    const activatedAt = payload?.activatedAt ?? member.activatedAt ?? new Date();
    let updated = await this.handoffs.updateFromActivation({
      partnerId,
      preference,
      consentAt,
      activatedAt,
    });
    if (!updated && member.partnerOf) {
      await this.ensureForMember({
        partnerId,
        mentorId: member.partnerOf,
        source: 'referral',
        joinedAt: member.createdAt ?? new Date(),
      });
      updated = await this.handoffs.updateFromActivation({
        partnerId,
        preference,
        consentAt,
        activatedAt,
      });
    }
    return updated
      ? { status: 'updated', task: updated }
      : { status: 'skipped', reason: 'no-task' };
  }
}

export const subscribeMentorHandoffFanout = ({ events, handoffs, partners }) => {
  const fanout = new MentorHandoffFanoutUseCase({ handoffs, partners });
  const offs = [
    events.on(ACTIVATION_EVENTS.MEMBER_SIGNED_UP, (payload) => fanout.onReferral(payload)),
    events.on(CAMPAIGN_ALLOCATED, (payload) => fanout.onAllocated(payload, 'allocation')),
    events.on(CAMPAIGN_OVERRIDDEN, (payload) => fanout.onAllocated(payload, 'override')),
    events.on(PARTNER_ACTIVATED, (payload) => fanout.onActivated(payload)),
  ];
  return () => offs.forEach((off) => off?.());
};
