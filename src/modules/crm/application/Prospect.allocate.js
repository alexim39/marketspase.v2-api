import { ConflictException, ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { scoreLead } from '../domain/LeadPool.js';
import { allocationTier } from '../../../shared/geo/campaignZones.js';
import { ProspectSurveyModel } from '../../../apps/survey/models/survey.model.js';
import { ProspectModel } from '../infrastructure/Prospect.models.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { CampaignModel } from '../../../apps/campaign/models/campaign.model.js';
import { CampaignAllocationModel } from '../../../apps/campaign/models/allocation.model.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';

/**
 * Internal lead allocation — system-matched pool leads → personal-list.
 *
 * A scheduled job (plus manual top-ups and activation kicks) walks Active
 * campaigns and assigns available pool rows to their owners:
 *  - hard filters: Active + allocation enabled/unpaused, state tier match,
 *    no duplicate in the partner's contacts, atomic first-take on the row;
 *  - debit-on-delivery: ₦300 (or the campaign's perLeadPrice) leaves the
 *    wallet only when a lead actually lands — never held, so Ending a
 *    campaign refunds nothing and strands nothing;
 *  - every assignment writes a ledger row, which is both the audit trail
 *    and the metric source (Manage funnel + ROI exact attribution via the
 *    campaignId stamped when the partner accepts the row into follow-ups).
 */

export const DEFAULT_PER_LEAD_PRICE = 300;
export const DEFAULT_DAILY_CAP = 5;
export const DEFAULT_TOTAL_CAP = 50;
/** Consecutive fund-failed runs before the matcher auto-pauses itself. */
export const AUTO_PAUSE_FUNDS_SKIPS = 5;

/** Category → survey-text signals for the affinity boost. */
const CATEGORY_SIGNALS = {
  'Health optimization': ['health', 'fitness', 'wellness', 'weight', 'energy', 'medical'],
  'Financial leverage system': ['passive income', 'financial', 'freedom', 'money', 'leverage', 'invest'],
  'Network marketing': ['network', 'team', 'community', 'people', 'marketing'],
  'Online business opportunity': ['online business', 'internet', 'digital', 'work from home', 'remote', 'online'],
  'Personal development': ['growth', 'mindset', 'personal', 'develop', 'success'],
  'Wealth & investing': ['invest', 'wealth', 'property', 'stocks', 'crypto', 'assets'],
  'Fitness & wellness': ['fitness', 'gym', 'weight', 'healthy', 'exercise'],
  'Beauty & skincare': ['beauty', 'skin', 'cosmetic'],
  'Business & entrepreneurship': ['business', 'entrepreneur', 'startup', 'company', 'ceo'],
  'Education & skills': ['learn', 'skill', 'school', 'course', 'training', 'education'],
  'Real estate': ['land', 'house', 'property', 'rent', 'estate'],
  'Youth empowerment': ['youth', 'student', 'graduate', 'campus'],
};

const dayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const allocOf = (campaign) => campaign?.allocation ?? {};

/** Fit boost on top of the pool score — neutral when data is missing. */
export function fitBonus(survey, campaign) {
  let bonus = 0;
  const reasons = [];
  const targetAge = String(campaign?.targetAudience?.ageRangeTarget ?? 'All').trim().toLowerCase();
  const leadAge = String(survey?.ageRange ?? '').trim().toLowerCase();
  if (targetAge && targetAge !== 'all' && leadAge) {
    if (targetAge === leadAge) {
      bonus += 5;
      reasons.push('Age match');
    } else {
      bonus -= 10;
    }
  }
  const signals = CATEGORY_SIGNALS[String(campaign?.category ?? '').trim()];
  if (signals) {
    const hay = [
      survey?.primaryOnlineBusinessMotivation, survey?.importanceOfPassiveIncome,
      survey?.onlineBusinessTimeDedication, survey?.comfortWithTech, survey?.referral,
    ].map((v) => String(v ?? '').toLowerCase()).join(' | ');
    if (hay && signals.some((s) => hay.includes(s))) {
      bonus += 8;
      reasons.push('Theme affinity');
    }
  }
  return { bonus, reasons };
}

/** Order candidates: tier first, then pool score + fit. */
export function rankCandidates(rows, campaign) {
  return rows
    .map((row) => {
      const tier = allocationTier(row, {
        scope: campaign?.targetAudience?.locationTarget ?? 'States',
        targets: campaign?.targetAudience?.locationTargets ?? [],
      });
      const pool = scoreLead(row, {});
      const fit = fitBonus(row, campaign);
      return { row, tier, score: pool.score + fit.bonus, reasons: [...pool.reasons, ...fit.reasons] };
    })
    .filter((c) => c.tier > 0)
    .sort((a, b) => a.tier - b.tier || b.score - a.score);
}

const ref9 = () => String(Math.floor(100000000 + Math.random() * 900000000));

export class AllocateCampaignLeadsUseCase {
  constructor({ surveys, prospects, partners, campaigns, ledger, transactions } = {}) {
    Object.assign(this, {
      surveys: surveys ?? ProspectSurveyModel,
      prospects: prospects ?? ProspectModel,
      partners: partners ?? PartnersModel,
      campaigns: campaigns ?? CampaignModel,
      ledger: ledger ?? CampaignAllocationModel,
      transactions: transactions ?? TransactionModel,
    });
  }

  async execute({ campaignId, limit = 10, now = new Date() } = {}) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(campaignId ?? ''))) throw new ValidationException('Invalid campaign');
    const campaign = await this.campaigns.findById(campaignId).lean().catch(() => null);
    if (!campaign) throw new NotFoundException('Campaign not found');
    const alloc = allocOf(campaign);
    const price = Number(alloc.perLeadPrice) > 0 ? Number(alloc.perLeadPrice) : DEFAULT_PER_LEAD_PRICE;
    const dailyCap = Number(alloc.dailyCap) > 0 ? Number(alloc.dailyCap) : DEFAULT_DAILY_CAP;
    const totalCap = Number(alloc.totalCap) > 0 ? Number(alloc.totalCap) : DEFAULT_TOTAL_CAP;
    if (campaign.deliveryStatus !== 'Active') return { campaignId: String(campaignId), delivered: 0, skipped: { inactive: 1 }, items: [] };
    if (alloc.enabled === false || alloc.paused) return { campaignId: String(campaignId), delivered: 0, skipped: { paused: 1 }, items: [] };

    // Flight gate (belt-and-braces alongside the expiry sweep): a fixed
    // flight whose end date has passed never allocates or debits again —
    // even if nobody flipped the status to Ended yet. Missing or legacy
    // fields default to continuous (never auto-stop spend on bad data).
    const flight = campaign.adDuration ?? {};
    const flightEnd = flight.campaignEndDate ? new Date(flight.campaignEndDate).getTime() : NaN;
    if (flight.noEndDate !== true && Number.isFinite(flightEnd) && flightEnd <= now.getTime()) {
      return { campaignId: String(campaignId), delivered: 0, skipped: { flightEnded: 1 }, items: [] };
    }

    const [deliveredToday, deliveredTotal] = await Promise.all([
      this.ledger.countDocuments({ campaignId: campaign._id, createdAt: { $gte: dayStart() } }).catch(() => 0),
      this.ledger.countDocuments({ campaignId: campaign._id }).catch(() => 0),
    ]);
    const take = Math.min(
      Math.max(Number(limit) || 10, 1),
      Math.max(dailyCap - deliveredToday, 0),
      Math.max(totalCap - deliveredTotal, 0)
    );
    if (take <= 0) {
      return { campaignId: String(campaignId), delivered: 0, skipped: { capped: 1 }, items: [] };
    }

    const partner = await this.partners
      .findById(campaign.createdBy).select('_id username email name surname').lean().catch(() => null);
    if (!partner) throw new NotFoundException('Campaign owner not found');
    const ownerName = [partner.name, partner.surname].filter(Boolean).join(' ') || partner.username;

    // Bounded candidate window (same discipline as the claim shelf).
    const rows = await this.surveys
      .find({ username: 'business', prospectStatus: 'Not Moved' })
      .sort({ createdAt: -1 }).limit(500).lean().catch(() => []);
    const allowOutOfArea = alloc.allowOutOfArea === true;
    const ranked = rankCandidates(rows ?? [], campaign)
      .filter((c) => c.tier < 3 || allowOutOfArea);

    // One duplicate sweep for the whole batch (phone is the key).
    const contacts = [...new Set(
      rows.flatMap((r) => [r.email, r.phoneNumber]).map((v) => String(v ?? '').trim()).filter(Boolean)
    )];
    const existing = contacts.length > 0
      ? await this.prospects.find({
        partnerId: partner._id,
        $or: [
          { prospectEmail: { $in: contacts } },
          { prospectPhone: { $in: contacts } },
        ],
      }).select('prospectEmail prospectPhone').lean().catch(() => [])
      : [];
    const seen = new Set(
      (existing ?? []).flatMap((e) => [e.prospectEmail, e.prospectPhone]).map((v) => String(v ?? '').trim()).filter(Boolean)
    );

    const skipped = { noMatch: 0, duplicate: 0, taken: 0, insufficientFunds: 0, failed: 0 };
    const items = [];
    let fundsNotice = false;
    for (const { row, tier, score } of ranked) {
      if (items.length >= take) break;
      const keys = [row.email, row.phoneNumber].map((v) => String(v ?? '').trim()).filter(Boolean);
      if (keys.some((k) => seen.has(k))) { skipped.duplicate += 1; continue; }
      keys.forEach((k) => seen.add(k));

      // Atomic first-take: only a row still owned by the pool moves.
      const taken = await this.surveys.findOneAndUpdate(
        { _id: row._id, username: 'business', prospectStatus: 'Not Moved' },
        { $set: { username: partner.username, campaignId: campaign._id, prospectStatus: 'Allocated', allocatedAt: now } },
        { new: true },
      ).lean().catch(() => null);
      if (!taken) { skipped.taken += 1; continue; }

      // Debit-on-delivery with a guarded atomic decrement (never negative).
      const debited = await this.partners.findOneAndUpdate(
        { _id: partner._id, balance: { $gte: price } },
        { $inc: { balance: -price } },
        { new: true },
      ).select('_id balance').lean().catch(() => null);
      if (!debited) {
        skipped.insufficientFunds += 1;
        await this.surveys.updateOne(
          { _id: row._id },
          { $set: { username: 'business', prospectStatus: 'Not Moved' }, $unset: { campaignId: '', allocatedAt: '' } },
        ).catch(() => null);
        // One funds notice per day — the job layer delivers it.
        const last = alloc.lastFundsNoticeAt ? new Date(alloc.lastFundsNoticeAt).getTime() : 0;
        if (!fundsNotice && Date.now() - last > 86400000) {
          fundsNotice = true;
          await this.campaigns.updateOne(
            { _id: campaign._id }, { $set: { 'allocation.lastFundsNoticeAt': now } },
          ).catch(() => null);
        }
        continue;
      }

      try {
        const reference = ref9();
        await this.transactions.create([{
          partnerId: partner._id,
          amount: price,
          status: 'Completed',
          paymentMethod: 'Campaign Lead Allocation',
          transactionType: 'Debit',
          reference,
        }]).catch(() => null);
        const entry = await this.ledger.create({
          campaignId: campaign._id,
          partnerId: partner._id,
          poolSurveyId: row._id,
          tier,
          score: Math.round(score * 100) / 100,
          costDebited: price,
          status: 'assigned',
        });
        await this.campaigns.updateOne(
          { _id: campaign._id },
          { $inc: { 'allocation.delivered': 1, 'allocation.spent': price }, $set: { 'allocation.lastRunAt': now } },
        ).catch(() => null);
        items.push({ poolSurveyId: String(row._id), tier, score, ledgerId: String(entry._id ?? entry.id) });
      } catch {
        skipped.failed += 1;
        // Compensate: row back to the pool, money back to the wallet.
        await this.surveys.updateOne(
          { _id: row._id },
          { $set: { username: 'business', prospectStatus: 'Not Moved' }, $unset: { campaignId: '', allocatedAt: '' } },
        ).catch(() => null);
        await this.partners.findOneAndUpdate({ _id: partner._id }, { $inc: { balance: price } }).catch(() => null);
      }
    }

    // Consecutive fund-failure tracking: deliveries reset the streak;
    // repeated skips auto-pause the matcher (state stays honest) and the
    // daily funds notice tells the partner to top up.
    const priorSkips = Number(alloc.fundsSkips) || 0;
    if (items.length > 0) {
      if (priorSkips > 0) {
        await this.campaigns.updateOne({ _id: campaign._id }, { $set: { 'allocation.fundsSkips': 0 } }).catch(() => null);
      }
    } else if (skipped.insufficientFunds > 0) {
      const next = priorSkips + 1;
      const patch = { 'allocation.fundsSkips': next, 'allocation.lastRunAt': now };
      if (next >= AUTO_PAUSE_FUNDS_SKIPS && !alloc.paused) {
        patch['allocation.paused'] = true;
        fundsNotice = true;
      }
      await this.campaigns.updateOne({ _id: campaign._id }, { $set: patch }).catch(() => null);
    }

    return {
      campaignId: String(campaign._id ?? campaignId),
      campaignName: campaign.campaignName ?? null,
      ownerId: String(partner._id),
      ownerName,
      delivered: items.length,
      skipped,
      items,
      fundsNotice,
    };
  }
}

/** Per-campaign allocation funnel for Manage detail + admin visibility. */
export class AllocationSummaryUseCase {
  constructor({ campaigns, ledger, prospects } = {}) {
    Object.assign(this, {
      campaigns: campaigns ?? CampaignModel,
      ledger: ledger ?? CampaignAllocationModel,
      prospects: prospects ?? ProspectModel,
    });
  }

  async execute({ campaignId, partnerId, isAdmin = false } = {}) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(campaignId ?? ''))) throw new ValidationException('Invalid campaign');
    const campaign = await this.campaigns.findById(campaignId).lean().catch(() => null);
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (!isAdmin && String(campaign.createdBy) !== String(partnerId)) {
      throw new ForbiddenException('Not your campaign');
    }
    const alloc = allocOf(campaign);
    const entries = await this.ledger.find({ campaignId: campaign._id }).lean().catch(() => []);
    const poolIds = (entries ?? []).map((e) => e.poolSurveyId).filter(Boolean);
    const accepted = poolIds.length > 0
      ? await this.prospects.find({ surverId: { $in: poolIds } }).select('status stageHistory communications').lean().catch(() => [])
      : [];
    const isConverted = (p) => String(p?.status?.stage ?? p?.status ?? '') === 'Converted';
    const isWorked = (p) => (p?.communications ?? []).length > 0 || (p?.stageHistory ?? []).length > 0;
    const byTier = { 1: 0, 2: 0, 3: 0 };
    let spent = 0;
    let reportedBad = 0;
    let replaced = 0;
    for (const e of entries ?? []) {
      if (e.tier === 1 || e.tier === 2 || e.tier === 3) byTier[e.tier] += 1;
      spent += Number(e.costDebited) || 0;
      if (e.status === 'reported-bad') reportedBad += 1;
      if (e.status === 'replaced') replaced += 1;
    }
    const price = Number(alloc.perLeadPrice) > 0 ? Number(alloc.perLeadPrice) : DEFAULT_PER_LEAD_PRICE;
    const dailyCap = Number(alloc.dailyCap) > 0 ? Number(alloc.dailyCap) : DEFAULT_DAILY_CAP;
    const totalCap = Number(alloc.totalCap) > 0 ? Number(alloc.totalCap) : DEFAULT_TOTAL_CAP;
    const deliveredToday = await this.ledger.countDocuments({
      campaignId: campaign._id, createdAt: { $gte: dayStart() },
    }).catch(() => 0);
    return {
      campaignId: String(campaign._id),
      category: campaign.category ?? '',
      status: campaign.deliveryStatus ?? null,
      caps: {
        enabled: alloc.enabled !== false,
        paused: alloc.paused === true,
        perLeadPrice: price,
        dailyCap,
        totalCap,
        allowOutOfArea: alloc.allowOutOfArea === true,
        fundsSkips: Number(alloc.fundsSkips) || 0,
      },
      delivered: (entries ?? []).length,
      deliveredToday,
      dailyRemaining: Math.max(dailyCap - deliveredToday, 0),
      totalRemaining: Math.max(totalCap - (entries ?? []).length, 0),
      accepted: (accepted ?? []).length,
      worked: (accepted ?? []).filter(isWorked).length,
      converted: (accepted ?? []).filter(isConverted).length,
      reportedBad,
      replaced,
      spent,
      byTier,
    };
  }
}

/** Partner flags one allocated lead as bad (dead line, wrong person). */
export class ReportAllocationUseCase {
  constructor({ ledger } = {}) {
    this.ledger = ledger ?? CampaignAllocationModel;
  }

  async execute({ allocationId, partnerId, reason = '' } = {}) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(allocationId ?? ''))) throw new ValidationException('Invalid allocation');
    const entry = await this.ledger.findById(allocationId).lean().catch(() => null);
    if (!entry) throw new NotFoundException('Allocation not found');
    if (String(entry.partnerId) !== String(partnerId)) throw new ForbiddenException('Not your allocation');
    if (!['assigned', 'accepted'].includes(entry.status)) {
      throw new ConflictException('This allocation can no longer be reported');
    }
    await this.ledger.updateOne(
      { _id: entry._id },
      { $set: { status: 'reported-bad', reportReason: String(reason ?? '').slice(0, 500) } },
    ).catch(() => null);
    return { allocationId: String(entry._id), status: 'reported-bad' };
  }
}

/**
 * Admin verdict on a reported allocation.
 * - replace: ₦300 credit back to the partner, ledger marked replaced, and
 *   the campaign's total cap grows by one so the next run refills the slot.
 * - reject: the report is dismissed, ledger returns to assigned.
 */
export class VerdictAllocationUseCase {
  constructor({ ledger, partners, transactions, campaigns } = {}) {
    Object.assign(this, {
      ledger: ledger ?? CampaignAllocationModel,
      partners: partners ?? PartnersModel,
      transactions: transactions ?? TransactionModel,
      campaigns: campaigns ?? CampaignModel,
    });
  }

  async execute({ allocationId, decision, note = '' } = {}) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(allocationId ?? ''))) throw new ValidationException('Invalid allocation');
    if (!['replace', 'reject'].includes(decision)) throw new ValidationException("Unknown decision (expected 'replace' or 'reject')");
    const entry = await this.ledger.findById(allocationId).lean().catch(() => null);
    if (!entry) throw new NotFoundException('Allocation not found');
    if (entry.status !== 'reported-bad') throw new ConflictException('This report is already decided');
    if (decision === 'reject') {
      await this.ledger.updateOne(
        { _id: entry._id },
        { $set: { status: 'assigned', decidedNote: String(note ?? '').slice(0, 500) } },
      ).catch(() => null);
      return { allocationId: String(entry._id), status: 'assigned' };
    }
    const credit = Number(entry.costDebited) || DEFAULT_PER_LEAD_PRICE;
    await this.partners.findOneAndUpdate({ _id: entry.partnerId }, { $inc: { balance: credit } }).catch(() => null);
    await this.transactions.create([{
      partnerId: entry.partnerId,
      amount: credit,
      status: 'Completed',
      paymentMethod: 'Campaign Lead Replacement',
      transactionType: 'Credit',
      reference: ref9(),
    }]).catch(() => null);
    await this.ledger.updateOne(
      { _id: entry._id },
      { $set: { status: 'replaced', decidedNote: String(note ?? '').slice(0, 500) } },
    ).catch(() => null);
    await this.campaigns.updateOne({ _id: entry.campaignId }, { $inc: { 'allocation.totalCap': 1 } }).catch(() => null);
    return { allocationId: String(entry._id), status: 'replaced', credited: credit };
  }
}
