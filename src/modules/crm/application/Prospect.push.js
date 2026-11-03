import { ConflictException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { ProspectModel } from '../infrastructure/Prospect.models.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { ProspectSurveyModel } from '../../../apps/survey/models/survey.model.js';

/**
 * Admin pool grants — two free handoffs from shared inventory to a partner.
 *
 * PushPoolLeadToPartnerUseCase: admin-granted claim. Copies the pool row
 * into the partner's pipeline (contact unlocks, 48h work clock via
 * claimedAt, pool row cleared) with no wallet debit: claimFeePaid is 0,
 * which also keeps the push outside the paid daily-cap count
 * (`claimFeePaid: { $gt: 0 }`).
 *
 * AssignPoolLeadToPartnerUseCase: inbox assignment. Transfers ownership of
 * the survey row itself (`username: 'business'` → target partner) with no
 * prospect copy. The row leaves the pool and lands in the partner's
 * My Page Leads inbox (and the admin page-leads desk under the new owner);
 * the partner accepts it into follow-ups free whenever ready.
 */
export class PushPoolLeadToPartnerUseCase {
  /** @param {{surveys, prospects, partners}} deps */
  constructor({ surveys, prospects, partners } = {}) {
    Object.assign(this, {
      surveys: surveys ?? ProspectSurveyModel,
      prospects: prospects ?? ProspectModel,
      partners: partners ?? PartnersModel,
    });
  }

  async execute({ leadId, username }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(leadId ?? ''))) throw new ValidationException('Invalid lead id');
    const target = String(username ?? '').trim();
    if (!target) throw new ValidationException('Provide a valid partner username');
    if (target.toLowerCase() === 'business') throw new ValidationException('Cannot push to business — business is the shared Buy Prospect pool. Enter a real partner username');
    const partner = await this.partners.findOne({ username: target }).select('_id username').lean().catch(() => null);
    if (!partner) throw new NotFoundException('Target partner not found');

    const survey = await this.surveys.findById(leadId).lean().catch(() => null);
    if (!survey || survey.username !== 'business') throw new NotFoundException('Lead is no longer in the pool');
    if (survey.prospectStatus === 'Moved to Contact') {
      throw new ConflictException('This lead was just claimed by someone else');
    }
    // Duplicate guard scoped to the target partner's contacts (blank
    // emails never match — families share inboxes, phone is the key).
    const ors = [];
    if (survey.email) ors.push({ prospectEmail: survey.email });
    if (survey.phoneNumber) ors.push({ prospectPhone: survey.phoneNumber });
    const dupe = ors.length > 0
      ? await this.prospects.findOne({ partnerId: partner._id, $or: ors }).lean().catch(() => null)
      : null;
    if (dupe) throw new ConflictException('This lead is already in their contacts');

    // Atomic first-push-wins take on the pool row.
    const taken = await this.surveys.findOneAndUpdate(
      { _id: leadId, prospectStatus: { $ne: 'Moved to Contact' } },
      { $set: { prospectStatus: 'Claimed' } },
      { new: true },
    ).lean().catch(() => null);
    if (!taken) throw new ConflictException('This lead was just claimed by someone else');

    try {
      const created = await this.prospects.create({
        prospectName: survey.name,
        prospectSurname: survey.surname ?? '',
        prospectEmail: survey.email ?? '',
        prospectPhone: survey.phoneNumber,
        prospectSource: 'Admin Push',
        partnerId: partner._id,
        claimedAt: new Date(),
        claimFeePaid: 0,
        poolReturns: Number(survey.claimCount) || 0,
        surverId: survey._id,
        survey: {
          ageRange: survey.ageRange,
          socialMedia: survey.socialMedia,
          employedStatus: survey.employedStatus,
          importanceOfPassiveIncome: survey.importanceOfPassiveIncome,
          onlinePurchaseSchedule: survey.onlinePurchaseSchedule,
          primaryOnlineBusinessMotivation: survey.primaryOnlineBusinessMotivation,
          comfortWithTech: survey.comfortWithTech,
          onlineBusinessTimeDedication: survey.onlineBusinessTimeDedication,
          referralCode: survey.referralCode,
          referral: survey.referral,
          country: survey.country,
          state: survey.state,
        },
      });
      await this.surveys.findByIdAndDelete(leadId).catch(() => null);
      return {
        prospectId: String(created._id ?? created.id),
        username: target,
      };
    } catch (err) {
      await this.surveys.updateOne({ _id: leadId }, { $set: { prospectStatus: 'Not Moved' } }).catch(() => null);
      throw err;
    }
  }
}

/**
 * Admin assign — hand a shared-pool lead to a partner's Page Leads inbox.
 * Single atomic ownership transfer: only a row still owned by 'business'
 * and still 'Not Moved' can move (stuck rows must be reopened first), so
 * concurrent assigns race on the filter and the loser gets a 409.
 * No prospect copy, no fee, no daily-cap interaction — the partner accepts
 * the row into follow-ups free via the normal Page Leads flow.
 */
export class AssignPoolLeadToPartnerUseCase {
  /** @param {{surveys, partners}} deps */
  constructor({ surveys, partners } = {}) {
    Object.assign(this, {
      surveys: surveys ?? ProspectSurveyModel,
      partners: partners ?? PartnersModel,
    });
  }

  async execute({ leadId, username }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(leadId ?? ''))) throw new ValidationException('Invalid lead id');
    const target = String(username ?? '').trim();
    if (!target) throw new ValidationException('Provide a valid partner username');
    if (target.toLowerCase() === 'business') throw new ValidationException('Cannot assign to business — business is the shared Buy Prospect pool. Enter a real partner username');
    const partner = await this.partners.findOne({ username: target }).select('_id username').lean().catch(() => null);
    if (!partner) throw new NotFoundException('Target partner not found');

    const moved = await this.surveys.findOneAndUpdate(
      { _id: leadId, username: 'business', prospectStatus: 'Not Moved' },
      { $set: { username: target } },
      { new: true },
    ).lean().catch(() => null);
    if (!moved) throw new ConflictException('Lead is no longer available in the pool');
    return { id: String(moved._id ?? leadId), username: target };
  }
}
