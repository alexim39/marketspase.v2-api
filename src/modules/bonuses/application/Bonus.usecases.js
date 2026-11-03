import {
  ConflictException, ForbiddenException, NotFoundException, ValidationException,
} from '../../../shared/domain/AppError.js';
import { BonusCampaignModel, BonusClaimModel } from '../infrastructure/Bonus.mongo.js';
import { PartnersModel, TransactionModel, runInTransaction } from '../../billing/infrastructure/Billing.models.js';
import { creditPartnerWallet } from '../../billing/application/Deposit.usecases.js';

const oid = (v) => String(v);
/** Await a Mongoose query or a plain fake (tests pass docs directly). */
const settle = async (query) => {
  if (!query) return query;
  if (typeof query.lean === 'function') return query.lean().catch(() => null);
  return query;
};
const newBonusReference = () =>
  `BONUS-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const isLive = (campaign, now = new Date()) => {
  if (!campaign || campaign.status !== 'active') return false;
  const t = new Date(now).getTime();
  if (campaign.startsAt && new Date(campaign.startsAt).getTime() > t) return false;
  if (campaign.endsAt && new Date(campaign.endsAt).getTime() <= t) return false;
  return true;
};

const shapedCampaign = (c) => c ? {
  id: oid(c._id ?? c.id),
  title: c.title,
  message: c.message ?? '',
  amountNgn: c.amountNgn,
  status: c.status,
  eligibleAfter: c.eligibleAfter ?? null,
  startsAt: c.startsAt ?? null,
  endsAt: c.endsAt ?? null,
} : null;

/** Eligible bonus for one member: first live, unclaimed campaign. */
export class GetEligibleBonusUseCase {
  /** @param {{campaigns, claims, partners}} deps */
  constructor({ campaigns, claims, partners } = {}) {
    Object.assign(this, {
      campaigns: campaigns ?? BonusCampaignModel,
      claims: claims ?? BonusClaimModel,
      partners: partners ?? PartnersModel,
    });
  }

  async execute({ partnerId, now = new Date() }) {
    const q = this.campaigns.find({ status: 'active' });
    let actives;
    if (q && typeof q.sort === 'function' && typeof q.lean === 'function') {
      // Mongoose query (has lean) — sort/limit server-side.
      actives = await q.sort({ createdAt: 1 }).limit(10).lean().catch(() => []);
    } else {
      // Plain fake (array) in unit tests.
      actives = await settle(q);
      if (Array.isArray(actives)) actives = actives.slice(0, 10);
    }
    const memberQ = this.partners.findById(partnerId);
    const member = await (memberQ && typeof memberQ.select === 'function'
      ? memberQ.select('createdAt').lean().catch(() => null)
      : memberQ);
    if (!member) throw new NotFoundException('Partner not found');
    const joined = member.createdAt ? new Date(member.createdAt).getTime() : 0;
    for (const campaign of actives ?? []) {
      if (!isLive(campaign, now)) continue;
      if (campaign.eligibleAfter && joined < new Date(campaign.eligibleAfter).getTime()) continue;
      const claimed = await settle(this.claims.findOne({ campaignId: campaign._id, partnerId }));
      if (claimed) continue;
      return { campaign: shapedCampaign(campaign), claimed: false };
    }
    return { campaign: null, claimed: false };
  }
}

/**
 * Claim an eligible bonus — atomic: claim reservation + wallet credit
 * travel in one transaction. Duplicate insert (race/double-tap) resolves
 * to "already claimed", never a second credit.
 */
export class ClaimBonusUseCase {
  /** @param {{campaigns, claims, partners, transactions, notifier?}} deps */
  constructor({ campaigns, claims, partners, transactions, notifier = null } = {}) {
    Object.assign(this, {
      campaigns: campaigns ?? BonusCampaignModel,
      claims: claims ?? BonusClaimModel,
      partners: partners ?? PartnersModel,
      transactions: transactions ?? TransactionModel,
      notifier,
    });
  }

  async execute({ partnerId, campaignId, now = new Date() }) {
    if (!campaignId || !String(campaignId).trim().match(/^[a-fA-F0-9]{24}$/)) {
      throw new ValidationException('Invalid campaign');
    }
    const campaign = await settle(this.campaigns.findById(campaignId));
    if (!campaign) throw new NotFoundException('Bonus campaign not found');
    if (!isLive(campaign, now)) throw new ForbiddenException('This bonus is no longer available');
    const memberQ = this.partners.findById(partnerId);
    const member = await (memberQ && typeof memberQ.select === 'function'
      ? memberQ.select('createdAt').lean().catch(() => null)
      : memberQ);
    if (!member) throw new NotFoundException('Partner not found');
    if (campaign.eligibleAfter && member.createdAt
      && new Date(member.createdAt).getTime() < new Date(campaign.eligibleAfter).getTime()) {
      throw new ForbiddenException('You are not eligible for this bonus');
    }
    const existing = await settle(this.claims.findOne({ campaignId, partnerId }));
    if (existing) throw new ConflictException('Bonus already claimed');
    const reference = newBonusReference();
    const out = await runInTransaction(async (session) => {
      const opt = session ? { session } : {};
      let claim;
      try {
        [claim] = await this.claims.create([{
          campaignId, partnerId, amountNgn: campaign.amountNgn, reference,
        }], opt);
      } catch (error) {
        if (error?.code === 11000) throw new ConflictException('Bonus already claimed');
        throw error;
      }
      const credited = await creditPartnerWallet(
        { partners: this.partners, transactions: this.transactions },
        { partnerId, amountNgn: campaign.amountNgn, paymentMethod: 'Welcome Bonus', reference },
        opt,
      );
      await this.claims.updateOne(
        { _id: claim._id },
        { $set: { transactionId: credited.transactionId } },
        opt,
      ).catch(() => null);
      return { ...credited, reference, claimId: String(claim._id) };
    });
    if (this.notifier) {
      await this.notifier(partnerId, campaign.amountNgn, reference).catch(() => null);
    }
    return { amountNgn: campaign.amountNgn, balance: out.balance, reference, transactionId: out.transactionId };
  }
}

/** Admin: list campaigns newest first. */
export class ListBonusCampaignsUseCase {
  /** @param {{campaigns, claims}} deps */
  constructor({ campaigns, claims } = {}) {
    Object.assign(this, {
      campaigns: campaigns ?? BonusCampaignModel,
      claims: claims ?? BonusClaimModel,
    });
  }

  async execute({ limit = 50 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const rows = await this.campaigns.find({}).sort({ createdAt: -1 }).limit(lim).lean();
    const out = [];
    for (const c of rows) {
      const claims = await this.claims.countDocuments({ campaignId: c._id }).catch(() => 0);
      out.push({ ...shapedCampaign(c), claims, createdAt: c.createdAt ?? null, updatedAt: c.updatedAt ?? null });
    }
    return { items: out, total: out.length };
  }
}

/** Admin: create a campaign. */
export class CreateBonusCampaignUseCase {
  /** @param {{campaigns}} deps */
  constructor({ campaigns } = {}) {
    this.campaigns = campaigns ?? BonusCampaignModel;
  }

  async execute({ adminId, title, message = '', amountNgn, eligibleAfter = null, startsAt = null, endsAt = null }) {
    const cleanTitle = String(title ?? '').trim().slice(0, 120);
    if (cleanTitle.length < 3) throw new ValidationException('Title is required');
    const amount = Number(amountNgn);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
      throw new ValidationException('Amount must be a whole naira value between 1 and 1,000,000');
    }
    const doc = await this.campaigns.create({
      title: cleanTitle,
      message: String(message ?? '').trim().slice(0, 500),
      amountNgn: amount,
      status: 'active',
      eligibleAfter: eligibleAfter ? new Date(eligibleAfter) : null,
      startsAt: startsAt ? new Date(startsAt) : new Date(),
      endsAt: endsAt ? new Date(endsAt) : null,
      createdBy: adminId ?? null,
    });
    return { campaign: shapedCampaign(doc.toObject?.() ?? doc) };
  }
}

/** Admin: edit amount/message/windows or enable/disable. */
export class UpdateBonusCampaignUseCase {
  /** @param {{campaigns}} deps */
  constructor({ campaigns } = {}) {
    this.campaigns = campaigns ?? BonusCampaignModel;
  }

  async execute({ campaignId, patch = {} }) {
    const doc = await this.campaigns.findById(campaignId);
    if (!doc) throw new NotFoundException('Bonus campaign not found');
    if (patch.title !== undefined) {
      const t = String(patch.title ?? '').trim().slice(0, 120);
      if (t.length < 3) throw new ValidationException('Title is required');
      doc.title = t;
    }
    if (patch.message !== undefined) doc.message = String(patch.message ?? '').trim().slice(0, 500);
    if (patch.amountNgn !== undefined) {
      const amount = Number(patch.amountNgn);
      if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
        throw new ValidationException('Amount must be a whole naira value between 1 and 1,000,000');
      }
      doc.amountNgn = amount;
    }
    if (patch.status !== undefined) {
      if (!['active', 'disabled'].includes(patch.status)) throw new ValidationException('Invalid status');
      doc.status = patch.status;
    }
    if (patch.eligibleAfter !== undefined) {
      doc.eligibleAfter = patch.eligibleAfter ? new Date(patch.eligibleAfter) : null;
    }
    if (patch.startsAt !== undefined) doc.startsAt = patch.startsAt ? new Date(patch.startsAt) : null;
    if (patch.endsAt !== undefined) doc.endsAt = patch.endsAt ? new Date(patch.endsAt) : null;
    await doc.save();
    const claims = await BonusClaimModel.countDocuments({ campaignId: doc._id }).catch(() => 0);
    return { campaign: { ...shapedCampaign(doc.toObject?.() ?? doc), claims } };
  }
}
