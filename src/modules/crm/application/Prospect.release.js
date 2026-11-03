import { ConflictException, ForbiddenException, NotFoundException } from '../../../shared/domain/AppError.js';
import { LEAD_RETURN_REFUND } from '../domain/LeadClaimFees.js';
import { normalizeState } from '../../../shared/geo/nigerianStates.js';
import { ProspectSurveyModel } from '../../../apps/survey/models/survey.model.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';

/**
 * Buy Prospect return window — a partner may send a pool-claimed lead back
 * within 7 days of pickup. Only pool-origin rows (surverId present) can
 * return; personal contacts can never be dumped into the public pool.
 * Pre-tracking claims (no claimedAt) are releasable — the window couldn't
 * be observed, and stale hoarded leads re-entering helps fairness.
 * Release rebuilds the pool row from the prospect (the claim path deletes
 * the survey) and removes the prospect row.
 */
export const RELEASE_WINDOW_DAYS = Number(process.env.LEAD_RELEASE_DAYS ?? 7) || 7;

const required = (v, fallback = 'Not provided') => {
  const s = String(v ?? '').trim();
  return s || fallback;
};

/** Prospect-side rating → pool ratings entry (score 1–5 only). */
const validRating = (r) => {
  const score = Number(r?.score);
  if (!Number.isFinite(score) || score < 1 || score > 5) return null;
  return {
    score: Math.round(score),
    at: r?.at ? new Date(r.at) : new Date(),
    ...(String(r?.note ?? '').trim() ? { note: String(r.note).trim().slice(0, 500) } : {}),
  };
};

export class ReleaseProspectToPoolUseCase {
  /** @param {{prospects, surveys, partners, transactions, refund?}} deps */
  constructor({ prospects, surveys, partners, transactions, refund } = {}) {
    Object.assign(this, {
      prospects,
      surveys: surveys ?? ProspectSurveyModel,
      partners: partners ?? PartnersModel,
      transactions: transactions ?? TransactionModel,
      refund: refund ?? LEAD_RETURN_REFUND,
    });
    if (!this.prospects) throw new Error('ReleaseProspectToPoolUseCase requires prospects');
  }

  async execute({ partnerId, prospectId }) {
    const p = await this.prospects.findById(prospectId);
    if (!p) throw new NotFoundException('Prospect not found');
    if (String(p.partnerId) !== String(partnerId)) {
      throw new ForbiddenException('You can only return your own leads');
    }
    if (!p.surverId && !p.survey) {
      throw new ConflictException('Only Buy Prospect leads can be returned to the pool');
    }
    if (p.status?.stage === 'Converted') {
      throw new ConflictException('Converted leads belong to you permanently and cannot be returned');
    }
    if (p.claimedAt) {
      const ageMs = Date.now() - new Date(p.claimedAt).getTime();
      if (ageMs > RELEASE_WINDOW_DAYS * 86400000) {
        throw new ConflictException(`Return window closed (${RELEASE_WINDOW_DAYS} days from pickup)`);
      }
    }
    const snap = p.survey ?? {};
    const phone = String(p.prospectPhone ?? '').trim();
    // Pool rows require a phone — never restore junk digits.
    if (!phone) throw new ConflictException('Cannot return a lead without a phone number');
    const restored = await this.surveys.create({
      name: required(p.prospectName),
      surname: p.prospectSurname ?? '',
      email: p.prospectEmail ?? '',
      phoneNumber: phone,
      ageRange: required(snap.ageRange),
      socialMedia: Array.isArray(snap.socialMedia) && snap.socialMedia.length > 0 ? snap.socialMedia : ['Not provided'],
      employedStatus: required(snap.employedStatus),
      importanceOfPassiveIncome: required(snap.importanceOfPassiveIncome),
      onlinePurchaseSchedule: required(snap.onlinePurchaseSchedule),
      primaryOnlineBusinessMotivation: required(snap.primaryOnlineBusinessMotivation),
      comfortWithTech: required(snap.comfortWithTech),
      onlineBusinessTimeDedication: required(snap.onlineBusinessTimeDedication),
      referralCode: snap.referralCode ?? '',
      referral: snap.referral ?? '',
      country: snap.country ?? 'Nigeria',
      state: snap.state ?? '',
      stateNorm: normalizeState(snap.state),
      username: 'business',
      prospectStatus: 'Not Moved',
      // Returns sink future rank (carried across cycles via the pickup
      // snapshot); a rating left on the prospect rides home.
      claimCount: (Number(p.poolReturns) || 0) + 1,
      ratings: validRating(p.rating) ? [{ ...validRating(p.rating), by: String(partnerId) }] : [],
    });
    await this.prospects.deleteById(prospectId);
    // Claim-fee refund (only when a fee was actually paid — legacy
    // pre-fee claims restore the pool row but move no money).
    let refunded = 0;
    if (Number(p.claimFeePaid) > 0 && this.refund > 0) {
      refunded = this.refund;
      try {
        await this.partners.findByIdAndUpdate(partnerId, { $inc: { balance: refunded } });
        await this.transactions.create([{
          partnerId,
          amount: refunded,
          status: 'Completed',
          paymentMethod: 'Lead Return Refund',
          transactionType: 'Credit',
          reference: Math.floor(100000000 + Math.random() * 900000000).toString(),
        }]);
      } catch (err) {
        // Lead is already returned at this point — never fail the request
        // over the refund; log loudly so ops can reconcile from this line.
        console.error(
          `[leadpool] REFUND FAILED partner=${partnerId} amount=${refunded} survey=${restored._id ?? restored.id}:`,
          err?.message ?? err,
        );
        refunded = 0;
      }
    }
    return { released: true, surveyId: String(restored._id ?? restored.id), refunded };
  }
}
