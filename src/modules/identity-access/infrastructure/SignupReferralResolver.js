import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { ProspectModel } from '../../../apps/prospect/models/prospect.model.js';

const PARTNER_FIELDS = '_id username accountState kycStatus suspendedAt';
const PROSPECT_FIELDS = '_id partnerId prospectEmail';

const queryLean = async (query) => {
  if (!query) return null;
  if (typeof query.lean === 'function') return query.lean();
  const resolved = await query;
  return resolved && typeof resolved.lean === 'function' ? resolved.lean() : resolved;
};

const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Only an active, verified, non-suspended partner can own a referral. */
export const isActiveReferrer = (partner) => Boolean(
  partner
  && !partner.suspendedAt
  && (partner.accountState == null || partner.accountState === 'partner')
  && (partner.kycStatus == null || partner.kycStatus === 'verified'),
);

/**
 * Resolves the owner of a signup:
 * 1. an explicit active partner referral (`/join?ref=username`),
 * 2. a converted pipeline lead (`lead=<prospectId>`),
 * 3. a converted prospect matched by signup email,
 * 4. otherwise the account is system-owned and campaign-allocation eligible.
 *
 * Unknown or inactive referrers never reject signup — they fall through to the
 * system-owned queue so the platform never loses a registration.
 */
export class SignupReferralResolver {
  constructor({ partners = PartnersModel, prospects = ProspectModel } = {}) {
    this.partners = partners;
    this.prospects = prospects;
  }

  async findPartnerByUsername(username) {
    return queryLean(this.partners.findOne(
      { username: String(username ?? '').trim().toLowerCase() },
      PARTNER_FIELDS,
    ));
  }

  async findPartnerById(partnerId) {
    return queryLean(this.partners.findById(partnerId, PARTNER_FIELDS));
  }

  async findConvertedProspect(filter) {
    const query = this.prospects.findOne(
      { ...filter, deletedAt: null, 'status.stage': 'Converted', convertedPartnerId: null },
      PROSPECT_FIELDS,
    );
    if (query && typeof query.sort === 'function') query.sort({ updatedAt: -1 });
    return queryLean(query);
  }

  async resolve({ ref = '', leadId = '', email = '', phone = '' } = {}) {
    const username = String(ref ?? '').trim().replace(/^@/, '').toLowerCase();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const lead = String(leadId ?? '').trim();

    let leadProspect = null;
    if (/^[a-fA-F0-9]{24}$/.test(lead)) {
      leadProspect = await this.findConvertedProspect({ _id: lead }).catch(() => null);
    }

    if (username) {
      const referrer = await this.findPartnerByUsername(username).catch(() => null);
      if (isActiveReferrer(referrer)) {
        const bindLead = leadProspect
          && String(leadProspect.partnerId) === String(referrer._id)
          ? String(leadProspect._id)
          : null;
        return {
          ownerId: String(referrer._id),
          source: 'referral',
          prospectId: bindLead,
          systemOwned: false,
        };
      }
    }

    if (leadProspect) {
      const owner = await this.findPartnerById(leadProspect.partnerId).catch(() => null);
      if (isActiveReferrer(owner)) {
        return {
          ownerId: String(owner._id),
          source: 'converted-lead',
          prospectId: String(leadProspect._id),
          systemOwned: false,
        };
      }
    }

    if (normalizedEmail) {
      const matched = await this.findConvertedProspect({
        prospectEmail: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i'),
      }).catch(() => null);
      if (matched) {
        const owner = await this.findPartnerById(matched.partnerId).catch(() => null);
        if (isActiveReferrer(owner)) {
          return {
            ownerId: String(owner._id),
            source: 'converted-lead-email',
            prospectId: String(matched._id),
            systemOwned: false,
          };
        }
      }
    }

    return {
      ownerId: null,
      source: username ? 'inactive-referrer' : 'organic',
      prospectId: null,
      systemOwned: true,
    };
  }

  /** Link the converted pipeline lead to the partner account it produced. */
  async bindProspect(prospectId, partnerId) {
    if (!prospectId || !partnerId) return { bound: false };
    const result = await this.prospects.updateOne(
      { _id: prospectId, deletedAt: null },
      { $set: { convertedPartnerId: partnerId, convertedAt: new Date() } },
    );
    return { bound: (result?.modifiedCount ?? 0) > 0 };
  }
}
