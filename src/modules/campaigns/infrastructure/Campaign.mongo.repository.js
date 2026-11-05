import crypto from 'node:crypto';
import {
  AppError,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import {
  PartnersModel,
  runInTransaction,
} from '../../identity-access/infrastructure/Auth.models.js';
import {
  ActivationQueueEntryModel,
  KycSubmissionModel,
} from '../../onboarding/infrastructure/Onboarding.models.js';
import {
  GrowthCampaignModel,
  PartnerAllocationModel,
} from './Campaign.models.js';
import {
  COST_PER_PROSPECT_NGN,
  DEFAULT_CAPACITY,
  DEFAULT_MAX_PER_WEEK,
  MIN_CAMPAIGN_BUDGET_NGN,
  MIN_PROSPECTS,
  campaignBudgetRemaining,
  campaignCapacity,
  isActivatedPartner,
  isKycVerified,
  ownerEligibleForCampaign,
  partnerEligibleForAllocation,
} from '../domain/Campaign.allocation.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const opts = (session, extra = {}) => (session ? { ...extra, session } : extra);
const objectId = (value) => String(value ?? '');
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const hasId = (value) => /^[a-fA-F0-9]{24}$/.test(objectId(value));

/** Legacy partners predate accountState/kycStatus; missing values mean active + verified. */
const activationEligibilityFilter = {
  $and: [
    { $or: [{ accountState: 'partner' }, { accountState: null }] },
    { $or: [{ kycStatus: 'verified' }, { kycStatus: null }] },
  ],
};

const publicSite = () => String(
  process.env.PUBLIC_SITE_URL ?? 'https://marketspase.com',
).replace(/\/+$/, '');

const weekStart = (now = new Date()) => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
};

const ownerProjection = 'name surname username email phone';
const partnerProjection = 'name surname username email phone address accountState kycStatus suspendedAt placementParentId placedAt';

const ownerLabel = (partner) => (
  [partner?.name, partner?.surname].filter(Boolean).join(' ') || partner?.username || partner?.email || 'Partner'
);

export const campaignRemaining = (campaign) => Math.max(
  Number(campaign?.budget?.total ?? 0)
  - Number(campaign?.budget?.spent ?? 0)
  - Number(campaign?.budget?.refunded ?? 0),
  0,
);

export const campaignDto = (campaign) => {
  if (!campaign) return null;
  const capacity = campaignCapacity(campaign);
  return {
    id: String(campaign._id),
    name: campaign.name,
    category: campaign.category ?? '',
    brief: campaign.brief ?? '',
    status: campaign.status,
    budget: {
      total: Number(campaign.budget?.total ?? 0),
      spent: Number(campaign.budget?.spent ?? 0),
      refunded: Number(campaign.budget?.refunded ?? 0),
      remaining: campaignRemaining(campaign),
    },
    flight: {
      startAt: campaign.flight?.startAt ?? null,
      endAt: campaign.flight?.endAt ?? null,
    },
    capacity: {
      total: Number(campaign.capacity?.total ?? 0),
      allocated: Number(campaign.capacity?.allocated ?? 0),
      remaining: capacity.remaining,
      maxPerWeek: Number(campaign.capacity?.maxPerWeek ?? DEFAULT_MAX_PER_WEEK),
    },
    targetAudience: {
      states: campaign.targetAudience?.states ?? [],
      ageRange: campaign.targetAudience?.ageRange ?? 'All',
      gender: campaign.targetAudience?.gender ?? 'All',
    },
    supportQuality: Number(campaign.supportQuality ?? 0),
    trackingCode: campaign.trackingCode,
    trackingUrl: `${publicSite()}/join?campaign=${encodeURIComponent(campaign.trackingCode)}`,
    adminNote: campaign.adminNote ?? null,
    refundReason: campaign.refundReason ?? null,
    refundedAt: campaign.refundedAt ?? null,
    createdAt: campaign.createdAt,
    activatedAt: campaign.activatedAt ?? null,
    pausedAt: campaign.pausedAt ?? null,
    endedAt: campaign.endedAt ?? null,
    lastAllocatedAt: campaign.lastAllocatedAt ?? null,
  };
};

export const adminCampaignDto = (campaign, owner) => ({
  ...campaignDto(campaign),
  owner: owner ? {
    id: String(owner._id),
    name: ownerLabel(owner),
    username: owner.username ?? '',
    email: owner.email ?? '',
    phone: owner.phone ?? '',
  } : null,
});

const allocationDto = (allocation, campaign, owner) => {
  if (!allocation) return null;
  return {
    id: String(allocation._id),
    status: allocation.status,
    allocatedAt: allocation.allocatedAt,
    score: allocation.score,
    components: allocation.components,
    explanation: allocation.explanation ?? [],
    campaign: campaign ? {
      id: String(campaign._id),
      name: campaign.name,
      status: campaign.status,
    } : null,
    owner: owner ? {
      id: String(owner._id),
      name: ownerLabel(owner),
      username: owner.username ?? '',
    } : null,
  };
};

export class MongoCampaignRepository {
  async findPartner(partnerId, { session } = {}) {
    if (!hasId(partnerId)) throw new ValidationException('Invalid partner id');
    return PartnersModel.findById(partnerId, partnerProjection, opts(session)).lean();
  }

  async assertOwnerEligible(partner) {
    if (!partner) throw new NotFoundException('Partner account not found');
    if (!isActivatedPartner(partner)) {
      throw new ForbiddenException('Activate your partner account before funding a campaign');
    }
    if (partner.suspendedAt) throw new ForbiddenException('Suspended accounts cannot fund campaigns');
    if (!isKycVerified(partner)) {
      throw new ForbiddenException('Identity verification must be verified before funding a campaign');
    }
  }

  async listMine(ownerId) {
    const campaigns = await GrowthCampaignModel.find({ ownerId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return campaigns.map(campaignDto);
  }

  async getMine(campaignId, ownerId) {
    if (!hasId(campaignId)) throw new ValidationException('Invalid campaign id');
    const campaign = await GrowthCampaignModel.findOne({ _id: campaignId, ownerId }).lean();
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaignDto(campaign);
  }

  async createCampaign({ ownerId, input, now = new Date() }) {
    const total = Number(input.budgetAmount);
    if (!Number.isFinite(total) || total < MIN_CAMPAIGN_BUDGET_NGN) {
      throw new ValidationException(`Minimum campaign budget is NGN ${MIN_CAMPAIGN_BUDGET_NGN.toLocaleString()} for ${MIN_PROSPECTS} prospects`);
    }
    if (total > 10000000) {
      throw new ValidationException('Campaign budget cannot exceed NGN 10,000,000');
    }
    const capacityTotal = Number(input.capacityTotal) || DEFAULT_CAPACITY;
    if (!Number.isInteger(capacityTotal) || capacityTotal < MIN_PROSPECTS || capacityTotal > 20) {
      throw new ValidationException(`Partner slots must be between ${MIN_PROSPECTS} and 20`);
    }
    const requiredBudget = capacityTotal * COST_PER_PROSPECT_NGN;
    if (total < requiredBudget) {
      throw new ValidationException(
        `Budget must cover ${capacityTotal} partner slots at NGN ${COST_PER_PROSPECT_NGN.toLocaleString()} each (NGN ${requiredBudget.toLocaleString()})`,
      );
    }
    const maxPerWeek = Math.min(
      Math.max(Number(input.maxPerWeek) || DEFAULT_MAX_PER_WEEK, 1),
      capacityTotal,
    );
    const startAt = input.startAt ? new Date(input.startAt) : now;
    if (Number.isNaN(startAt.getTime())) throw new ValidationException('Invalid start date');
    const endAt = input.endAt ? new Date(input.endAt) : null;
    if (endAt && Number.isNaN(endAt.getTime())) throw new ValidationException('Invalid end date');
    if (endAt && endAt <= startAt) throw new ValidationException('End date must be after the start date');

    const owner = await this.findPartner(ownerId);
    await this.assertOwnerEligible(owner);

    const trackingCode = `gc_${crypto.randomBytes(6).toString('hex')}`;
    const fundingReference = `GCF-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    return runInTransaction(async (session) => {
      const debited = await PartnersModel.findOneAndUpdate(
        {
          _id: ownerId,
          suspendedAt: null,
          balance: { $gte: total },
          ...activationEligibilityFilter,
        },
        { $inc: { balance: -total } },
        opts(session, { new: true }),
      ).lean();

      if (!debited) {
        const latest = await this.findPartner(ownerId, { session });
        await this.assertOwnerEligible(latest);
        throw new AppError('Insufficient wallet balance', 409, 'INSUFFICIENT_BALANCE');
      }

      const [campaign] = await GrowthCampaignModel.create(
        [{
          ownerId,
          name: input.name,
          category: input.category ?? '',
          brief: input.brief ?? '',
          status: 'Pending',
          budget: { total, spent: 0, refunded: 0 },
          flight: { startAt, endAt },
          capacity: {
            total: capacityTotal,
            allocated: 0,
            maxPerWeek,
          },
          targetAudience: {
            states: Array.isArray(input.targetStates) ? input.targetStates : [],
            ageRange: input.ageRange ?? 'All',
            gender: input.gender ?? 'All',
          },
          supportQuality: Number(input.supportQuality ?? 60),
          trackingCode,
          fundingReference,
        }],
        opts(session),
      );

      await TransactionModel.create(
        [{
          partnerId: ownerId,
          amount: total,
          reference: fundingReference,
          status: 'Completed',
          paymentMethod: 'Growth Campaign Funding',
          transactionType: 'Debit',
          date: now,
        }],
        opts(session),
      );

      return campaignDto(campaign.toObject());
    });
  }

  async cancelCampaign({ campaignId, ownerId, reason, now = new Date() }) {
    if (!hasId(campaignId)) throw new ValidationException('Invalid campaign id');
    return runInTransaction(async (session) => {
      const campaign = await GrowthCampaignModel.findOne(
        { _id: campaignId, ownerId, status: 'Pending' },
        null,
        opts(session),
      ).lean();
      if (!campaign) {
        const exists = await GrowthCampaignModel.findOne({ _id: campaignId, ownerId }, null, opts(session)).lean();
        if (!exists) throw new NotFoundException('Campaign not found');
        throw new ConflictException('Only pending campaigns can be cancelled');
      }

      const refund = campaignRemaining(campaign);
      const cancelled = await GrowthCampaignModel.findOneAndUpdate(
        { _id: campaignId, ownerId, status: 'Pending' },
        {
          $set: {
            status: 'Cancelled',
            refundedAt: refund > 0 ? now : null,
            refundReason: reason ?? 'Owner cancelled before activation',
            adminNote: reason ?? 'Owner cancelled before activation',
          },
          ...(refund > 0 ? { $inc: { 'budget.refunded': refund } } : {}),
        },
        opts(session, { new: true }),
      ).lean();

      if (!cancelled) throw new ConflictException('Campaign can no longer be cancelled');
      if (refund > 0) {
        await this.refundOwner({
          ownerId: campaign.ownerId,
          amount: refund,
          reference: `GCREF-${campaign._id}`,
          method: 'Growth Campaign Refund',
          note: reason ?? 'Owner cancelled',
          actorId: ownerId,
          now,
          session,
        });
      }
      return campaignDto(cancelled);
    });
  }

  async listAdmin({ status, page = 1, limit = 25 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const filter = status ? { status } : {};
    const [rows, total] = await Promise.all([
      GrowthCampaignModel.find(filter)
        .sort({ createdAt: 1 })
        .skip((current - 1) * size)
        .limit(size)
        .lean(),
      GrowthCampaignModel.countDocuments(filter),
    ]);
    const ownerIds = [...new Set(rows.map((row) => String(row.ownerId)))];
    const owners = await PartnersModel.find({ _id: { $in: ownerIds } })
      .select(ownerProjection)
      .lean();
    const ownerMap = new Map(owners.map((owner) => [String(owner._id), owner]));
    return {
      data: rows.map((row) => adminCampaignDto(row, ownerMap.get(String(row.ownerId)))),
      meta: {
        page: current,
        limit: size,
        total,
        pages: Math.max(Math.ceil(total / size), 1),
      },
    };
  }

  async attribution(limit = 100) {
    const size = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const rows = await PartnersModel.aggregate([
      { $match: { campaignCode: { $type: 'string', $nin: [''] } } },
      {
        $group: {
          _id: '$campaignCode',
          signups: { $sum: 1 },
          activated: { $sum: { $cond: [{ $eq: ['$accountState', 'partner'] }, 1, 0] } },
          kycVerified: { $sum: { $cond: [{ $eq: ['$kycStatus', 'verified'] }, 1, 0] } },
          lastSignupAt: { $max: '$createdAt' },
        },
      },
      { $sort: { signups: -1, _id: 1 } },
      { $limit: size },
    ]);

    const codes = rows.map((row) => String(row._id));
    const campaigns = codes.length
      ? await GrowthCampaignModel.find({ trackingCode: { $in: codes } })
        .select('trackingCode name status ownerId')
        .lean()
      : [];
    const byCode = new Map(campaigns.map((campaign) => [campaign.trackingCode, campaign]));

    return rows.map((row) => {
      const code = String(row._id);
      const campaign = byCode.get(code);
      const signups = Number(row.signups ?? 0);
      const activated = Number(row.activated ?? 0);
      return {
        campaignCode: code,
        campaign: campaign
          ? { id: String(campaign._id), name: campaign.name, status: campaign.status }
          : null,
        signups,
        activated,
        kycVerified: Number(row.kycVerified ?? 0),
        activationRate: signups ? round((activated / signups) * 100) : 0,
        lastSignupAt: row.lastSignupAt ?? null,
      };
    });
  }

  async activateCampaign({ campaignId, adminId, now = new Date() }) {
    const campaign = await this.findAdminCampaign(campaignId);
    if (campaign.status !== 'Pending') throw new ConflictException('Only pending campaigns can be activated');
    if (campaign.flight?.endAt && new Date(campaign.flight.endAt) <= now) {
      throw new ConflictException('This campaign flight has already ended');
    }
    const owner = await this.findPartner(campaign.ownerId);
    await this.assertOwnerEligible(owner);

    const updated = await GrowthCampaignModel.findOneAndUpdate(
      { _id: campaignId, status: 'Pending' },
      { $set: { status: 'Active', activatedAt: now, activatedBy: adminId, pausedAt: null } },
      { new: true },
    ).lean();
    if (!updated) throw new ConflictException('Campaign can no longer be activated');
    return adminCampaignDto(updated, owner);
  }

  async pauseCampaign({ campaignId, actorId, ownerId = null, now = new Date() }) {
    const filter = { _id: campaignId, status: 'Active', ...(ownerId ? { ownerId } : {}) };
    const campaign = await GrowthCampaignModel.findOneAndUpdate(
      filter,
      { $set: { status: 'Paused', pausedAt: now } },
      { new: true },
    ).lean();
    if (!campaign) {
      const exists = await GrowthCampaignModel.findById(campaignId).lean();
      if (!exists) throw new NotFoundException('Campaign not found');
      throw new ConflictException('Only active campaigns can be paused');
    }
    return campaignDto(campaign);
  }

  async resumeCampaign({ campaignId, ownerId = null, now = new Date() }) {
    const filter = { _id: campaignId, status: 'Paused', ...(ownerId ? { ownerId } : {}) };
    const campaign = await GrowthCampaignModel.findOne(filter).lean();
    if (!campaign) {
      const exists = await GrowthCampaignModel.findById(campaignId).lean();
      if (!exists) throw new NotFoundException('Campaign not found');
      throw new ConflictException('Only paused campaigns can be resumed');
    }
    if (campaign.flight?.endAt && new Date(campaign.flight.endAt) <= now) {
      throw new ConflictException('This campaign flight has already ended');
    }
    const updated = await GrowthCampaignModel.findOneAndUpdate(
      { _id: campaignId, status: 'Paused', ...(ownerId ? { ownerId } : {}) },
      { $set: { status: 'Active', pausedAt: null } },
      { new: true },
    ).lean();
    if (!updated) throw new ConflictException('Campaign can no longer be resumed');
    return campaignDto(updated);
  }

  async rejectCampaign({ campaignId, adminId, reason, now = new Date() }) {
    return this.closePendingCampaign({
      campaignId,
      adminId,
      reason,
      status: 'Cancelled',
      now,
    });
  }

  async endCampaign({ campaignId, adminId, spentAmount, note, now = new Date() }) {
    const campaign = await this.findAdminCampaign(campaignId);
    if (!['Active', 'Paused'].includes(campaign.status)) {
      throw new ConflictException('Only active or paused campaigns can be ended');
    }
    const unrefunded = Math.max(
      Number(campaign.budget?.total ?? 0) - Number(campaign.budget?.refunded ?? 0),
      0,
    );
    const spent = Number(spentAmount);
    if (!Number.isFinite(spent) || spent < 0 || spent > unrefunded) {
      throw new ValidationException(`Spent amount must be between 0 and NGN ${unrefunded.toLocaleString()}`);
    }
    const refund = round(unrefunded - spent);

    return runInTransaction(async (session) => {
      const ended = await GrowthCampaignModel.findOneAndUpdate(
        { _id: campaignId, status: { $in: ['Active', 'Paused'] } },
        {
          $set: {
            status: 'Ended',
            endedAt: now,
            endedBy: adminId,
            pausedAt: null,
            'budget.spent': spent,
            adminNote: note ?? null,
            refundedAt: refund > 0 ? now : null,
            refundReason: refund > 0 ? (note ?? 'Unspent campaign budget returned') : null,
          },
          ...(refund > 0 ? { $inc: { 'budget.refunded': refund } } : {}),
        },
        opts(session, { new: true }),
      ).lean();

      if (!ended) throw new ConflictException('Campaign can no longer be ended');
      if (refund > 0) {
        await this.refundOwner({
          ownerId: campaign.ownerId,
          amount: refund,
          reference: `GCEND-${campaign._id}`,
          method: 'Growth Campaign Closeout',
          note: note ?? 'Unspent budget refunded',
          actorId: adminId,
          now,
          session,
        });
      }
      const owner = await this.findPartner(campaign.ownerId, { session });
      return adminCampaignDto(ended, owner);
    });
  }

  async queueSnapshot({ limit = 200 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const [entries, total] = await Promise.all([
      ActivationQueueEntryModel.find({ status: 'queued' })
        .sort({ enteredAt: 1 })
        .limit(size)
        .lean(),
      ActivationQueueEntryModel.countDocuments({ status: 'queued' }),
    ]);
    const partnerIds = entries.map((entry) => entry.partnerId);
    const [partners, kycRows] = await Promise.all([
      PartnersModel.find({ _id: { $in: partnerIds } })
        .select(partnerProjection)
        .lean(),
      KycSubmissionModel.find({ partnerId: { $in: partnerIds } })
        .select('partnerId state')
        .lean(),
    ]);
    const partnerMap = new Map(partners.map((partner) => [String(partner._id), partner]));
    const stateMap = new Map(kycRows.map((row) => [String(row.partnerId), row.state]));
    const now = new Date();

    return {
      data: entries.map((entry, index) => {
        const partner = partnerMap.get(String(entry.partnerId));
        const state = partner?.address?.state || stateMap.get(String(entry.partnerId)) || '';
        const eligible = partnerEligibleForAllocation(partner);
        const reasons = [];
        if (!partner) reasons.push('Partner record missing');
        if (partner && !isActivatedPartner(partner)) reasons.push('Not activated');
        if (partner?.suspendedAt) reasons.push('Suspended');
        if (partner && !isKycVerified(partner)) reasons.push(`KYC ${partner.kycStatus ?? 'not_started'}`);
        if (partner?.placementParentId) reasons.push('Already placed');
        return {
          queueEntryId: String(entry._id),
          partner: partner ? {
            id: String(partner._id),
            name: ownerLabel(partner),
            username: partner.username ?? '',
            email: partner.email ?? '',
            phone: partner.phone ?? '',
            state,
            kycStatus: isKycVerified(partner) ? 'verified' : (partner?.kycStatus ?? 'not_started'),
          } : null,
          position: index + 1,
          status: entry.status,
          enteredAt: entry.enteredAt,
          waitDays: round(Math.max((now - new Date(entry.enteredAt)) / DAY_MS, 0)),
          eligible,
          reasons,
        };
      }),
      meta: {
        total,
        limit: size,
        capped: total > entries.length,
      },
    };
  }

  async listPlacedPartners(ownerId) {
    const allocations = await PartnerAllocationModel.find({ ownerId, status: 'active' })
      .sort({ allocatedAt: -1 })
      .limit(200)
      .lean();
    const partnerIds = allocations.map((row) => row.partnerId);
    const campaignIds = [...new Set(allocations.map((row) => String(row.campaignId)))];
    const [partners, campaigns] = await Promise.all([
      PartnersModel.find({ _id: { $in: partnerIds } })
        .select(partnerProjection)
        .lean(),
      GrowthCampaignModel.find({ _id: { $in: campaignIds } })
        .select('name status')
        .lean(),
    ]);
    const partnerMap = new Map(partners.map((partner) => [String(partner._id), partner]));
    const campaignMap = new Map(campaigns.map((campaign) => [String(campaign._id), campaign]));
    return allocations.map((allocation) => {
      const partner = partnerMap.get(String(allocation.partnerId));
      const campaign = campaignMap.get(String(allocation.campaignId));
      return {
        id: String(allocation._id),
        allocatedAt: allocation.allocatedAt,
        score: allocation.score,
        partner: partner ? {
          id: String(partner._id),
          name: ownerLabel(partner),
          username: partner.username ?? '',
          email: partner.email ?? '',
          phone: partner.phone ?? '',
          state: partner.address?.state ?? '',
        } : null,
        campaign: campaign ? {
          id: String(campaign._id),
          name: campaign.name,
          status: campaign.status,
        } : null,
      };
    });
  }

  async myAllocation(partnerId) {
    const queue = await ActivationQueueEntryModel.findOne({ partnerId }).lean();
    const allocation = await PartnerAllocationModel.findOne({
      partnerId,
      status: 'active',
    }).sort({ allocatedAt: -1 }).lean();
    if (!allocation) {
      let position = null;
      if (queue?.status === 'queued') {
        position = (await ActivationQueueEntryModel.countDocuments({
          status: 'queued',
          enteredAt: { $lte: queue.enteredAt },
          _id: { $ne: queue._id },
        })) + 1;
      }
      return {
        queue: queue ? {
          status: queue.status,
          enteredAt: queue.enteredAt,
          allocatedAt: queue.allocatedAt ?? null,
          position,
        } : null,
        allocation: null,
      };
    }

    const [campaign, owner] = await Promise.all([
      GrowthCampaignModel.findById(allocation.campaignId).lean(),
      PartnersModel.findById(allocation.ownerId).select(ownerProjection).lean(),
    ]);
    return {
      queue: queue ? {
        status: queue.status,
        enteredAt: queue.enteredAt,
        allocatedAt: queue.allocatedAt ?? null,
        position: null,
      } : null,
      allocation: allocationDto(allocation, campaign, owner),
    };
  }

  async loadAllocationContext({ campaignId = null } = {}) {
    const campaignFilter = campaignId
      ? { _id: campaignId, status: 'Active' }
      : { status: 'Active' };
    if (campaignId && !hasId(campaignId)) throw new ValidationException('Invalid campaign id');

    const campaigns = await GrowthCampaignModel.find(campaignFilter)
      .sort({ createdAt: 1 })
      .limit(40)
      .lean();
    if (campaignId && campaigns.length === 0) {
      const exists = await GrowthCampaignModel.findById(campaignId).lean();
      if (!exists) throw new NotFoundException('Campaign not found');
      throw new ConflictException('Campaign is not active');
    }

    const ownerIds = [...new Set(campaigns.map((campaign) => String(campaign.ownerId)))];
    const owners = await PartnersModel.find({ _id: { $in: ownerIds } })
      .select(`${partnerProjection} role`)
      .lean();
    const ownerMap = new Map(owners.map((owner) => [String(owner._id), owner]));

    const queue = await ActivationQueueEntryModel.find({ status: 'queued' })
      .sort({ enteredAt: 1 })
      .limit(500)
      .lean();
    const partnerIds = queue.map((entry) => entry.partnerId);
    const [partners, kycRows, activeAllocations] = await Promise.all([
      PartnersModel.find({ _id: { $in: partnerIds } })
        .select(partnerProjection)
        .lean(),
      KycSubmissionModel.find({ partnerId: { $in: partnerIds } })
        .select('partnerId state')
        .lean(),
      PartnerAllocationModel.find({ partnerId: { $in: partnerIds }, status: 'active' })
        .select('partnerId')
        .lean(),
    ]);

    const partnerMap = new Map(partners.map((partner) => [String(partner._id), partner]));
    const stateMap = new Map(kycRows.map((row) => [String(row.partnerId), row.state]));
    const allocatedSet = new Set(activeAllocations.map((row) => String(row.partnerId)));

    const campaignIds = campaigns.map((campaign) => campaign._id);
    const weekly = await PartnerAllocationModel.aggregate([
      {
        $match: {
          campaignId: { $in: campaignIds },
          allocatedAt: { $gte: weekStart() },
        },
      },
      { $group: { _id: '$campaignId', count: { $sum: 1 } } },
    ]).catch(() => []);
    const weeklyMap = new Map(weekly.map((row) => [String(row._id), Number(row.count) || 0]));

    const candidates = queue
      .map((entry) => {
        const partner = partnerMap.get(String(entry.partnerId));
        if (!partner) return null;
        if (allocatedSet.has(String(partner._id))) return null;
        if (!partnerEligibleForAllocation(partner)) return null;
        return {
          queueEntry: entry,
          partner,
          partnerState: partner.address?.state || stateMap.get(String(partner._id)) || '',
        };
      })
      .filter(Boolean);

    return {
      campaigns: campaigns.map((campaign) => ({
        campaign,
        owner: ownerMap.get(String(campaign.ownerId)) ?? null,
        weeklyAllocated: weeklyMap.get(String(campaign._id)) ?? 0,
      })).filter(({ owner }) => ownerEligibleForCampaign(owner)),
      candidates,
      now: new Date(),
    };
  }

  async allocatePair({
    campaignId,
    ownerId,
    queueEntryId,
    partnerId,
    score,
    components,
    explanation,
    weeklyCap,
    now = new Date(),
  }) {
    if (String(partnerId) === String(ownerId)) {
      throw new ConflictException('Self-placement is not allowed');
    }
    return runInTransaction(async (session) => {
      const owner = await PartnersModel.findOne(
        { _id: ownerId, suspendedAt: null, ...activationEligibilityFilter },
        null,
        opts(session),
      ).lean();
      if (!owner) throw new ConflictException('Campaign owner is no longer eligible');

      const weeklyCount = await PartnerAllocationModel.countDocuments(
        { campaignId, allocatedAt: { $gte: weekStart(now) } },
        opts(session),
      );
      if (weeklyCount >= Math.max(Number(weeklyCap) || 1, 1)) {
        throw new ConflictException('Campaign weekly allocation cap reached');
      }

      const queue = await ActivationQueueEntryModel.findOneAndUpdate(
        { _id: queueEntryId, partnerId, status: 'queued' },
        {
          $set: {
            status: 'allocated',
            allocatedAt: now,
            campaignId,
            placementParentId: ownerId,
            cancelledAt: null,
          },
        },
        opts(session, { new: true }),
      ).lean();
      if (!queue) throw new ConflictException('Partner is no longer queued');

      const campaign = await GrowthCampaignModel.findOneAndUpdate(
        {
          _id: campaignId,
          status: 'Active',
          $expr: {
            $and: [
              { $lt: ['$capacity.allocated', '$capacity.total'] },
              {
                $gte: [
                  {
                    $subtract: [
                      '$budget.total',
                      { $add: ['$budget.spent', '$budget.refunded'] },
                    ],
                  },
                  COST_PER_PROSPECT_NGN,
                ],
              },
            ],
          },
        },
        {
          $inc: {
            'capacity.allocated': 1,
            'budget.spent': COST_PER_PROSPECT_NGN,
          },
          $set: { lastAllocatedAt: now },
        },
        opts(session, { new: true }),
      ).lean();
      if (!campaign) throw new ConflictException('Campaign has no remaining capacity or budget');

      const partner = await PartnersModel.findOneAndUpdate(
        {
          _id: partnerId,
          suspendedAt: null,
          placementParentId: null,
          ...activationEligibilityFilter,
        },
        {
          $set: {
            placementParentId: ownerId,
            placementCampaignId: campaignId,
            placedAt: now,
          },
        },
        opts(session, { new: true }),
      ).lean();
      if (!partner) throw new ConflictException('Partner is no longer eligible for placement');

      const [allocation] = await PartnerAllocationModel.create(
        [{
          partnerId,
          ownerId,
          campaignId,
          queueEntryId,
          status: 'active',
          score,
          components,
          explanation,
          allocatedAt: now,
        }],
        opts(session),
      );

      // Auto-close when the last slot is filled or the remaining budget can no
      // longer cover another allocation. Any leftover is returned immediately.
      let finalCampaign = campaign;
      const remainingBudget = campaignBudgetRemaining(campaign);
      const capacityFull = Number(campaign.capacity?.allocated ?? 0)
        >= Number(campaign.capacity?.total ?? 0);
      if (capacityFull || remainingBudget < COST_PER_PROSPECT_NGN) {
        const refund = remainingBudget;
        const ended = await GrowthCampaignModel.findOneAndUpdate(
          { _id: campaignId, status: 'Active' },
          {
            $set: {
              status: 'Ended',
              endedAt: now,
              pausedAt: null,
              ...(refund > 0 ? {
                refundedAt: now,
                refundReason: 'Campaign completed — unspent budget returned',
              } : {}),
            },
            ...(refund > 0 ? { $inc: { 'budget.refunded': refund } } : {}),
          },
          opts(session, { new: true }),
        ).lean();
        if (ended) {
          finalCampaign = ended;
          if (refund > 0) {
            await this.refundOwner({
              ownerId,
              amount: refund,
              reference: `GCAUTO-${campaignId}-${allocation._id}`,
              method: 'Growth Campaign Closeout',
              note: 'Campaign completed — unspent budget returned',
              actorId: null,
              now,
              session,
            });
          }
        }
      }

      return {
        allocation: allocationDto(allocation.toObject(), finalCampaign, await this.findPartner(ownerId, { session })),
        campaign: campaignDto(finalCampaign),
        partner: {
          id: String(partner._id),
          name: ownerLabel(partner),
          email: partner.email ?? '',
        },
      };
    });
  }

  async findAdminCampaign(campaignId) {
    if (!hasId(campaignId)) throw new ValidationException('Invalid campaign id');
    const campaign = await GrowthCampaignModel.findById(campaignId).lean();
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async closePendingCampaign({ campaignId, adminId, reason, status, now }) {
    return runInTransaction(async (session) => {
      const campaign = await GrowthCampaignModel.findOne(
        { _id: campaignId, status: 'Pending' },
        null,
        opts(session),
      ).lean();
      if (!campaign) {
        const exists = await GrowthCampaignModel.findById(campaignId, null, opts(session)).lean();
        if (!exists) throw new NotFoundException('Campaign not found');
        throw new ConflictException('Only pending campaigns can be closed');
      }
      const refund = campaignRemaining(campaign);
      const closed = await GrowthCampaignModel.findOneAndUpdate(
        { _id: campaignId, status: 'Pending' },
        {
          $set: {
            status,
            adminNote: reason,
            refundReason: refund > 0 ? reason : null,
            refundedAt: refund > 0 ? now : null,
            endedAt: status === 'Ended' ? now : null,
            endedBy: status === 'Ended' ? adminId : null,
          },
          ...(refund > 0 ? { $inc: { 'budget.refunded': refund } } : {}),
        },
        opts(session, { new: true }),
      ).lean();
      if (!closed) throw new ConflictException('Campaign can no longer be closed');
      if (refund > 0) {
        await this.refundOwner({
          ownerId: campaign.ownerId,
          amount: refund,
          reference: `GCREF-${campaign._id}`,
          method: 'Growth Campaign Refund',
          note: reason,
          actorId: adminId,
          now,
          session,
        });
      }
      const owner = await this.findPartner(campaign.ownerId, { session });
      return adminCampaignDto(closed, owner);
    });
  }

  async refundOwner({ ownerId, amount, reference, method, note, actorId, now, session }) {
    if (!(amount > 0)) return 0;
    const owner = await PartnersModel.findByIdAndUpdate(
      ownerId,
      { $inc: { balance: Number(amount) } },
      opts(session, { new: true }),
    ).lean();
    if (!owner) throw new NotFoundException('Campaign owner not found');
    await TransactionModel.create(
      [{
        partnerId: ownerId,
        amount: Number(amount),
        reference,
        status: 'Completed',
        paymentMethod: method,
        transactionType: 'Credit',
        date: now,
        decidedBy: actorId,
        decidedAt: now,
        decisionNote: note ?? null,
      }],
      opts(session),
    );
    return Number(amount);
  }
}
