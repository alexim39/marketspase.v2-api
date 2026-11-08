import { ConflictException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { ProspectModel } from '../infrastructure/Prospect.models.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { ProspectSurveyModel } from '../../../apps/survey/models/survey.model.js';

/**
 * POST /v1/prospects/accept-page-lead — free accept of your own page lead.
 * Session-owned: survey.username must equal the caller's username (exact).
 * No wallet movement (page leads are yours, not pool inventory). Creates a
 * ProspectModel (source Unique Link) and removes the survey row so the inbox
 * count drops and the pipeline gains the contact. Duplicate phone/email
 * within your contacts is rejected before anything is written.
 */
export class AcceptPageLeadUseCase {
  constructor({ surveys, prospects, partners } = {}) {
    Object.assign(this, {
      surveys: surveys ?? ProspectSurveyModel,
      prospects: prospects ?? ProspectModel,
      partners: partners ?? PartnersModel,
    });
  }

  async execute({ partnerId, surveyId }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(surveyId ?? ''))) throw new ValidationException('Invalid lead id');
    const [me, survey] = await Promise.all([
      this.partners.findById(partnerId).select('username').lean().catch(() => null),
      this.surveys.findById(surveyId).lean().catch(() => null),
    ]);
    if (!me) throw new NotFoundException('Partner not found');
    if (!survey || survey.username === 'business') throw new NotFoundException('Page lead not found');
    if (String(survey.username) !== String(me.username)) {
      throw new NotFoundException('Page lead not found');
    }
    const ors = [];
    if (survey.email) ors.push({ prospectEmail: survey.email });
    if (survey.phoneNumber) ors.push({ prospectPhone: survey.phoneNumber });
    if (ors.length > 0) {
      const dupe = await this.prospects.findOne({ partnerId, $or: ors }).lean().catch(() => null);
      if (dupe) throw new ConflictException('This lead is already in your pipeline');
    }
    const created = await this.prospects.create({
      prospectName: survey.name,
      prospectSurname: survey.surname ?? '',
      prospectEmail: survey.email ?? '',
      prospectPhone: survey.phoneNumber,
      prospectSource: 'Unique Link',
      partnerId,
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
    return { prospectId: String(created._id ?? created.id) };
  }
}
