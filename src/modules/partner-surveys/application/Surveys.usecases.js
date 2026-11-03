import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { PartnerSurveyModel } from '../../../apps/survey/models/survey.model.js';

const shape = (d) => ({
  id: String(d._id),
  name: d.name ?? '',
  gender: d.gender ?? '',
  phoneNumber: d.phoneNumber ?? '',
  reservationCode: d.reservationCode ?? '',
  difficulty: d.difficulty ?? '',
  challenges: d.challenges ?? [],
  strategies: d.strategies ?? [],
  targetAudience: d.targetAudience ?? [],
  recruitmentTool: d.recruitmentTool ?? '',
  misconception: d.misconception ?? '',
  businessMotivation: d.businessMotivation ?? '',
  recruitmentAttempt: d.recruitmentAttempt ?? '',
  trainingSupport: d.trainingSupport ?? '',
  comfortWithTech: d.comfortWithTech ?? '',
  businessTimeDedication: d.businessTimeDedication ?? '',
  interestedInTraining: d.interestedInTraining ?? '',
  createdAt: d.createdAt ?? null,
});

/**
 * GET /v1/admin/partner-surveys — partner-survey inbox + analytics.
 * Source: public :4202 survey (PartnerSurveyModel). One round trip returns
 * rows + summary so the admin page renders KPIs without extra calls.
 * Summary is built for product analytics: pain points (challenges,
 * difficulty), leverage (strategies, tools, audiences) and training demand.
 */
export class ListPartnerSurveysUseCase {
  constructor({ surveys } = {}) {
    this.surveys = surveys ?? PartnerSurveyModel;
  }

  async execute({ q = null, limit = 25, skip = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const filter = {};
    const needle = String(q ?? '').trim().slice(0, 80);
    if (needle) {
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { phoneNumber: rx }, { reservationCode: rx }];
    }
    // Summary runs as one $facet aggregation (constant memory) instead of
    // loading every survey row into the process — the old find({}) grew
    // with the platform.
    const rank = (field, n = 5, unwind = false) => {
      const path = `$${field}`;
      const pipe = unwind ? [{ $unwind: path }] : [];
      return [
        ...pipe,
        { $group: { _id: path, count: { $sum: 1 } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { count: -1 } },
        { $limit: n },
        { $project: { _id: 0, label: '$_id', count: 1 } },
      ];
    };
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const [rows, total, agg] = await Promise.all([
      this.surveys.find(filter).sort({ createdAt: -1 }).skip(sk).limit(lim).lean().catch(() => []),
      this.surveys.countDocuments(filter).catch(() => 0),
      this.surveys.aggregate([
        {
          $facet: {
            totals: [{ $count: 'total' }],
            new7d: [{ $match: { createdAt: { $gte: weekAgo } } }, { $count: 'n' }],
            topChallenges: rank('challenges', 5, true),
            topStrategies: rank('strategies', 5, true),
            topAudiences: rank('targetAudience', 5, true),
            byDifficulty: rank('difficulty', 10),
            byTool: rank('recruitmentTool', 10),
            trainingDemand: rank('trainingSupport', 10),
            wantsTraining: [
              { $match: { interestedInTraining: /yes/i } },
              { $count: 'n' },
            ],
          },
        },
      ]).catch(() => []),
    ]);
    const f = agg?.[0] ?? {};
    const one = (arr) => arr?.[0] ?? {};
    return {
      items: (rows ?? []).map(shape),
      total,
      summary: {
        total: one(f.totals).total ?? 0,
        new7d: one(f.new7d).n ?? 0,
        topChallenges: f.topChallenges ?? [],
        topStrategies: f.topStrategies ?? [],
        topAudiences: f.topAudiences ?? [],
        byDifficulty: f.byDifficulty ?? [],
        byTool: f.byTool ?? [],
        trainingDemand: f.trainingDemand ?? [],
        wantsTraining: one(f.wantsTraining).n ?? 0,
      },
    };
  }
}

/**
 * GET /v1/admin/partner-surveys/:id — full row for inspection.
 */
export class GetPartnerSurveyUseCase {
  constructor({ surveys } = {}) {
    this.surveys = surveys ?? PartnerSurveyModel;
  }

  async execute({ id }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid id');
    const doc = await this.surveys.findById(id).lean().catch(() => null);
    if (!doc) throw new NotFoundException('Survey not found');
    return shape(doc);
  }
}

/**
 * DELETE /v1/admin/partner-surveys/:id — hard delete one row.
 * Survey rows are pre-relationship data; deleting removes the row only.
 */
export class DeletePartnerSurveyUseCase {
  constructor({ surveys } = {}) {
    this.surveys = surveys ?? PartnerSurveyModel;
  }

  async execute({ id }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid id');
    const doc = await this.surveys.findById(id).lean().catch(() => null);
    if (!doc) throw new NotFoundException('Survey not found');
    await this.surveys.deleteOne({ _id: id }).catch(() => null);
    return { id: String(id), name: doc.name ?? '' };
  }
}
