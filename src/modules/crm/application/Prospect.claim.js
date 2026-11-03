import { AppError, ConflictException, NotFoundException } from '../../../shared/domain/AppError.js';
import { LEAD_CLAIM_FEE } from '../domain/LeadClaimFees.js';
import { DAILY_CLAIM_LIMIT } from '../domain/LeadPool.js';
import { ProspectModel } from '../infrastructure/Prospect.models.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { ProspectSurveyModel } from '../../../apps/survey/models/survey.model.js';

const sourceName = (source) => {
  if (source === 'link') return 'Unique Link';
  return 'Website';
};

/**
 * Paid pool claim — the single code path behind every Buy Prospect pickup
 * (v1 claim endpoint + legacy import-single, which now delegates here).
 * Order is the money-safety model: verify pool row → duplicate check →
 * atomic survey claim (first click wins) → atomic wallet debit (no
 * overdraft, no document-save validation traps) → create prospect →
 * delete survey → record debit. Anything failing after the debit triggers
 * compensation (refund + survey release) so money never strands.
 */
export class ClaimPoolLeadUseCase {
  /** @param {{surveys, prospects, partners, transactions, fee?, dailyLimit?}} deps */
  constructor({ surveys, prospects, partners, transactions, fee, dailyLimit } = {}) {
    Object.assign(this, {
      surveys: surveys ?? ProspectSurveyModel,
      prospects: prospects ?? ProspectModel,
      partners: partners ?? PartnersModel,
      transactions: transactions ?? TransactionModel,
      fee: fee ?? LEAD_CLAIM_FEE,
      dailyLimit: dailyLimit ?? DAILY_CLAIM_LIMIT,
    });
  }

  async execute({ partnerId, surveyId, source = 'website' }) {
    const survey = await this.surveys.findById(surveyId).lean().catch(() => null);
    if (!survey || survey.username !== 'business') throw new NotFoundException('Lead is no longer in the pool');
    if (survey.prospectStatus === 'Moved to Contact') {
      throw new ConflictException('This lead was just claimed by someone else');
    }
    // Daily anti-hoarding cap counts paid pickups since local midnight.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const claimedToday = await this.prospects.countDocuments({
      partnerId, claimedAt: { $gte: dayStart }, claimFeePaid: { $gt: 0 },
    }).catch(() => 0);
    if (claimedToday >= (this.dailyLimit ?? DAILY_CLAIM_LIMIT)) {
      throw new ConflictException(`Daily claim limit reached (${this.dailyLimit ?? DAILY_CLAIM_LIMIT} leads per day)`);
    }
    // Duplicate guard before money moves (scoped to the claimer's contacts;
    // blank emails never match — families share inboxes, phone is the key).
    const ors = [];
    if (survey.email) ors.push({ prospectEmail: survey.email });
    if (survey.phoneNumber) ors.push({ prospectPhone: survey.phoneNumber });
    const dupe = ors.length > 0
      ? await this.prospects.findOne({ partnerId, $or: ors }).lean().catch(() => null)
      : null;
    if (dupe) throw new ConflictException('This lead is already in your contacts');

    // Atomic first-click-wins claim on the pool row.
    const claimed = await this.surveys.findOneAndUpdate(
      { _id: surveyId, prospectStatus: { $ne: 'Moved to Contact' } },
      { $set: { prospectStatus: 'Claimed' } },
      { new: true },
    ).lean().catch(() => null);
    if (!claimed) throw new ConflictException('This lead was just claimed by someone else');

    // Atomic conditional debit — insufficient funds stop here, pre-create.
    const charged = await this.partners.findOneAndUpdate(
      { _id: partnerId, balance: { $gte: this.fee } },
      { $inc: { balance: -this.fee } },
      { new: true },
    ).lean().catch(() => null);
    if (!charged) {
      await this.surveys.updateOne({ _id: surveyId }, { $set: { prospectStatus: 'Not Moved' } }).catch(() => null);
      throw new AppError('Insufficient wallet balance — fund your wallet to claim leads', 401, 'INSUFFICIENT_BALANCE');
    }

    try {
      const created = await this.prospects.create({
        prospectName: survey.name,
        prospectSurname: survey.surname ?? '',
        prospectEmail: survey.email ?? '',
        prospectPhone: survey.phoneNumber,
        prospectSource: sourceName(source),
        partnerId,
        claimedAt: new Date(),
        claimFeePaid: this.fee,
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
      await this.surveys.findByIdAndDelete(surveyId).catch(() => null);
      const tx = await this.transactions.create([{
        partnerId,
        amount: this.fee,
        status: 'Completed',
        paymentMethod: 'Lead Claim',
        transactionType: 'Debit',
        reference: Math.floor(100000000 + Math.random() * 900000000).toString(),
      }]);
      const txDoc = Array.isArray(tx) ? tx[0] : tx;
      return {
        prospectId: String(created._id ?? created.id),
        fee: this.fee,
        balance: charged.balance ?? null,
        transactionId: String(txDoc?._id ?? txDoc?.id ?? ''),
      };
    } catch (err) {
      // Compensation: money back, pool row released, then the real error.
      await this.partners.findByIdAndUpdate(partnerId, { $inc: { balance: this.fee } }).catch(() => null);
      await this.surveys.updateOne({ _id: surveyId }, { $set: { prospectStatus: 'Not Moved' } }).catch(() => null);
      throw err;
    }
  }
}
