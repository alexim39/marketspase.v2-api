import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { normalizeState } from '../../../shared/geo/nigerianStates.js';
import { ProspectSurveyModel } from '../../../apps/survey/models/survey.model.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';

const PAGE_LEAD_STATUSES = ['Not Moved', 'Claimed', 'Moved to Contact', 'Returned from contact List'];

const pageLeadShape = (d) => ({
  id: String(d._id),
  name: d.name ?? '',
  surname: d.surname ?? '',
  phoneNumber: d.phoneNumber ?? '',
  email: d.email ?? '',
  state: d.state ?? '',
  status: d.prospectStatus ?? 'Not Moved',
  owner: d.username ?? '',
  source: 'Page',
  createdAt: d.createdAt ?? null,
  answers: {
    ageRange: d.ageRange ?? '',
    socialMedia: d.socialMedia ?? [],
    employedStatus: d.employedStatus ?? '',
    importanceOfPassiveIncome: d.importanceOfPassiveIncome ?? '',
    onlinePurchaseSchedule: d.onlinePurchaseSchedule ?? '',
    primaryOnlineBusinessMotivation: d.primaryOnlineBusinessMotivation ?? '',
    comfortWithTech: d.comfortWithTech ?? '',
    onlineBusinessTimeDedication: d.onlineBusinessTimeDedication ?? '',
    referral: d.referral ?? '',
    referralCode: d.referralCode ?? '',
    country: d.country ?? '',
  },
});

/**
 * GET /v1/prospects/admin/page-leads — private page-lead desk.
 * Every row here belongs to exactly one partner (username != 'business'):
 * submissions via /:partnerUsername. Never in the Buy Prospect pool.
 */
export class ListAdminPageLeadsUseCase {
  constructor({ surveys } = {}) {
    this.surveys = surveys ?? ProspectSurveyModel;
  }

  async execute({ q = null, owner = null, state = null, status = null, limit = 25, skip = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const filter = { username: { $ne: 'business' } };
    const needle = String(q ?? '').trim().slice(0, 60);
    if (needle) {
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { surname: rx }, { phoneNumber: rx }, { email: rx }];
    }
    const own = String(owner ?? '').trim().slice(0, 80);
    if (own) filter.username = own;
    if (state) filter.stateNorm = normalizeState(state);
    if (PAGE_LEAD_STATUSES.includes(status)) filter.prospectStatus = status;
    const [rows, total, summary] = await Promise.all([
      this.surveys.find(filter).sort({ createdAt: -1 }).skip(sk).limit(lim).lean().catch(() => []),
      this.surveys.countDocuments(filter).catch(() => 0),
      this.surveys.aggregate([
        { $match: { username: { $ne: 'business' } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            new7d: {
              $sum: {
                $cond: [{ $gte: ['$createdAt', new Date(Date.now() - 7 * 86400000)] }, 1, 0],
              },
            },
          },
        },
      ]).catch(() => []),
    ]);
    const s = summary?.[0] ?? {};
    return {
      items: (rows ?? []).map(pageLeadShape),
      total,
      summary: { total: s.total ?? 0, new7d: s.new7d ?? 0 },
    };
  }
}

/**
 * DELETE /v1/prospects/admin/page-leads/:id — hard delete one private row.
 * Removes the survey row only; accepted pipeline copies are untouched
 * (they live in ProspectModel under the owner's partnerId).
 */
export class DeleteAdminPageLeadUseCase {
  constructor({ surveys } = {}) {
    this.surveys = surveys ?? ProspectSurveyModel;
  }

  async execute({ id }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid lead id');
    const doc = await this.surveys.findById(id).lean().catch(() => null);
    if (!doc || doc.username === 'business') throw new NotFoundException('Page lead not found');
    await this.surveys.deleteOne({ _id: id }).catch(() => null);
    return { id: String(id), name: `${doc.name ?? ''} ${doc.surname ?? ''}`.trim(), owner: doc.username };
  }
}

/**
 * PATCH /v1/prospects/admin/page-leads/:id — reassign owner.
 * Moves a misattributed submission to the correct partner username
 * (must exist, must not be 'business'). The new owner sees it in
 * My Page Leads instantly; the old owner loses it.
 */
export class ReassignAdminPageLeadUseCase {
  constructor({ surveys, partners } = {}) {
    this.surveys = surveys ?? ProspectSurveyModel;
    this.partners = partners ?? PartnersModel;
  }

  async execute({ id, owner }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid lead id');
    const target = String(owner ?? '').trim();
    if (!target) throw new ValidationException('Provide a valid partner username');
    if (target.toLowerCase() === 'business') throw new ValidationException('Cannot reassign to business — business is the shared Buy Prospect pool. Enter a real partner username (e.g. market)');
    const partner = await this.partners.findOne({ username: target }).select('_id username').lean().catch(() => null);
    if (!partner) throw new NotFoundException('Target partner not found');
    const doc = await this.surveys.findOneAndUpdate(
      { _id: id, username: { $ne: 'business' } },
      { $set: { username: target } },
      { new: true },
    ).lean().catch(() => null);
    if (!doc) throw new NotFoundException('Page lead not found');
    return { id: String(doc._id), owner: target };
  }
}
