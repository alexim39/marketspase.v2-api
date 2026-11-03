import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import {
  PartnersModel,
  runInTransaction,
} from '../../identity-access/infrastructure/Auth.models.js';
import { ActivationOrderModel } from '../../onboarding/infrastructure/Onboarding.models.js';
import {
  CommissionSaleModel,
  GrowthCommissionModel,
  MentorBonusModel,
} from './Compensation.models.js';
import {
  MENTOR_BONUS_AMOUNT,
  MENTOR_BONUS_DAYS,
  MENTOR_BONUS_EXPIRY_DAYS,
  MAX_LEVELS,
  RANKS,
  commissionAmount,
  depthAllows,
  planSummary,
  rankDepth,
  rateForLevel,
} from '../domain/Compensation.plan.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const opts = (session, extra = {}) => (session ? { ...extra, session } : extra);
const hasId = (value) => /^[a-fA-F0-9]{24}$/.test(String(value ?? ''));
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const labelOf = (partner) => (
  [partner?.name, partner?.surname].filter(Boolean).join(' ') || partner?.username || partner?.email || 'Partner'
);
const normalizedRank = (rank) => (RANKS.includes(rank) ? rank : 'Partner');
const dateOrNow = (value) => {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

const publicEntry = (entry, earner, buyer) => ({
  id: String(entry._id),
  orderId: String(entry.orderId),
  level: entry.level,
  rate: entry.rate,
  amount: entry.amount,
  grossMargin: entry.grossMargin,
  status: entry.status,
  rankAtAccrual: entry.rankAtAccrual,
  createdAt: entry.createdAt,
  releasedAt: entry.releasedAt ?? null,
  voidedAt: entry.voidedAt ?? null,
  recoveredAmount: entry.recoveredAmount ?? 0,
  outstandingAmount: entry.outstandingAmount ?? 0,
  earner: earner ? { id: String(earner._id), name: labelOf(earner), username: earner.username ?? '' } : null,
  buyer: buyer ? { id: String(buyer._id), name: labelOf(buyer), username: buyer.username ?? '' } : null,
});

const publicBonus = (bonus, activation, mentor) => ({
  id: String(bonus._id),
  orderId: String(bonus.orderId),
  amount: bonus.amount,
  dueAt: bonus.dueAt,
  expiresAt: bonus.expiresAt,
  status: bonus.status,
  paidAt: bonus.paidAt ?? null,
  note: bonus.note ?? null,
  recoveredAmount: bonus.recoveredAmount ?? 0,
  outstandingAmount: bonus.outstandingAmount ?? 0,
  activationPartner: activation ? {
    id: String(activation._id),
    name: labelOf(activation),
    username: activation.username ?? '',
  } : null,
  mentor: mentor ? {
    id: String(mentor._id),
    name: labelOf(mentor),
    username: mentor.username ?? '',
  } : null,
});

export class MongoCompensationRepository {
  async recordActivation({ orderId, partnerId, orderNumber, productName, grossMargin, activatedAt }) {
    if (!hasId(orderId) || !hasId(partnerId)) throw new ValidationException('Invalid activation identity');
    const at = dateOrNow(activatedAt);
    const margin = Math.max(Number(grossMargin) || 0, 0);
    const dueAt = new Date(at.getTime() + (MENTOR_BONUS_DAYS * DAY_MS));
    const expiresAt = new Date(dueAt.getTime() + (MENTOR_BONUS_EXPIRY_DAYS * DAY_MS));

    return runInTransaction(async (session) => {
      const sale = await CommissionSaleModel.findOneAndUpdate(
        { orderId },
        {
          $setOnInsert: {
            orderId,
            partnerId,
            orderNumber: orderNumber ?? '',
            productName: productName ?? '',
            grossMargin: margin,
            status: 'pending_placement',
            activatedAt: at,
          },
        },
        opts(session, { new: true, upsert: true, setDefaultsOnInsert: true }),
      ).lean();

      const bonus = await MentorBonusModel.findOneAndUpdate(
        { orderId },
        {
          $setOnInsert: {
            orderId,
            activationPartnerId: partnerId,
            amount: MENTOR_BONUS_AMOUNT,
            dueAt,
            expiresAt,
            status: 'scheduled',
          },
        },
        opts(session, { new: true, upsert: true, setDefaultsOnInsert: true }),
      ).lean();

      return { sale, bonus };
    });
  }

  async handleAllocation({ partnerId, ownerId, campaignId }) {
    if (!hasId(partnerId) || !hasId(ownerId)) throw new ValidationException('Invalid allocation identity');
    const now = new Date();
    const sales = await CommissionSaleModel.find({
      partnerId,
      status: 'pending_placement',
    }).limit(20).lean();
    const results = [];

    for (const sale of sales) {
      const result = await runInTransaction(async (session) => {
        const claimed = await CommissionSaleModel.findOneAndUpdate(
          { _id: sale._id, status: 'pending_placement' },
          {
            $set: {
              status: 'accrued',
              placementParentId: ownerId,
              accruedAt: now,
            },
          },
          opts(session, { new: true }),
        ).lean();
        if (!claimed) return null;

        const visited = new Set();
        let earnerId = ownerId;
        let entries = 0;
        for (let level = 1; level <= MAX_LEVELS; level += 1) {
          if (!earnerId || visited.has(String(earnerId))) break;
          visited.add(String(earnerId));
          const earner = await PartnersModel.findById(
            earnerId,
            'name surname username commissionRank accountState kycStatus suspendedAt placementParentId',
            opts(session),
          ).lean();
          if (!earner) break;
          if (String(earner._id) === String(partnerId)) break;

          const rank = normalizedRank(earner.commissionRank);
          const active = earner.accountState === 'partner'
            && !earner.suspendedAt
            && (earner.kycStatus ?? 'verified') === 'verified';
          if (active && depthAllows(rank, level)) {
            const rate = rateForLevel(level);
            const amount = commissionAmount(claimed.grossMargin, level);
            if (amount > 0) {
              await GrowthCommissionModel.findOneAndUpdate(
                { saleId: claimed._id, level },
                {
                  $setOnInsert: {
                    saleId: claimed._id,
                    orderId: claimed.orderId,
                    partnerId: claimed.partnerId,
                    earnerId: earner._id,
                    level,
                    rate,
                    amount,
                    grossMargin: claimed.grossMargin,
                    rankAtAccrual: rank,
                    status: 'Pending',
                  },
                },
                opts(session, { new: true, upsert: true, setDefaultsOnInsert: true }),
              ).lean();
              entries += 1;
            }
          }

          earnerId = earner.placementParentId ?? null;
        }

        await MentorBonusModel.updateOne(
          { orderId: claimed.orderId, status: 'scheduled', mentorId: null },
          { $set: { mentorId: ownerId } },
          opts(session),
        );

        return {
          saleId: String(claimed._id),
          partnerId: String(claimed.partnerId),
          campaignId: campaignId ? String(campaignId) : null,
          entries,
        };
      });
      if (result) results.push(result);
    }

    return results;
  }

  async cancelActivation({ partnerId, orderId, reason }) {
    if (!hasId(orderId)) return { cancelled: false };
    const now = new Date();
    return runInTransaction(async (session) => {
      const sale = await CommissionSaleModel.findOne(
        { orderId, ...(hasId(partnerId) ? { partnerId } : {}) },
        null,
        opts(session),
      ).lean();
      let entriesVoided = 0;
      let entriesReversed = 0;
      if (sale && sale.status !== 'cancelled') {
        const pending = await GrowthCommissionModel.updateMany(
          { saleId: sale._id, status: 'Pending' },
          {
            $set: {
              status: 'Voided',
              voidedAt: now,
              voidedBy: null,
              reversalReason: reason ?? 'Activation reversed',
            },
          },
          opts(session),
        );
        entriesVoided = pending.modifiedCount ?? 0;

        const released = await GrowthCommissionModel.find(
          { saleId: sale._id, status: 'Released' },
          null,
          opts(session),
        ).lean();
        for (const entry of released) {
          const claimed = await GrowthCommissionModel.findOneAndUpdate(
            { _id: entry._id, status: 'Released' },
            {
              $set: {
                status: 'Reversed',
                reversalReason: reason ?? 'Activation reversed',
              },
            },
            opts(session, { new: true }),
          ).lean();
          if (!claimed) continue;
          const recovery = await this.clawbackEarner({
            earnerId: entry.earnerId,
            amount: entry.amount,
            reference: `COMREV-${entry._id}`,
            note: reason ?? 'Activation reversed',
            session,
            now,
          });
          await GrowthCommissionModel.updateOne(
            { _id: entry._id },
            {
              $set: {
                recoveredAmount: recovery.recovered,
                outstandingAmount: recovery.outstanding,
              },
            },
            opts(session),
          );
          entriesReversed += 1;
        }

        await CommissionSaleModel.updateOne(
          { _id: sale._id },
          {
            $set: {
              status: 'cancelled',
              cancelledAt: now,
              cancelReason: reason ?? 'Activation reversed',
            },
          },
          opts(session),
        );
      }

      const bonus = await MentorBonusModel.findOne({ orderId }, null, opts(session)).lean();
      let bonusStatus = null;
      if (bonus && bonus.status === 'scheduled') {
        await MentorBonusModel.updateOne(
          { _id: bonus._id, status: 'scheduled' },
          {
            $set: {
              status: 'cancelled',
              note: reason ?? 'Activation reversed',
            },
          },
          opts(session),
        );
        bonusStatus = 'cancelled';
      } else if (bonus && bonus.status === 'paid') {
        const claimed = await MentorBonusModel.findOneAndUpdate(
          { _id: bonus._id, status: 'paid' },
          {
            $set: {
              status: 'clawed_back',
              note: reason ?? 'Activation reversed',
            },
          },
          opts(session, { new: true }),
        ).lean();
        if (claimed) {
          const recovery = await this.clawbackEarner({
            earnerId: bonus.mentorId,
            amount: bonus.amount,
            reference: `MBCB-${bonus._id}`,
            note: reason ?? 'Activation reversed',
            session,
            now,
          });
          await MentorBonusModel.updateOne(
            { _id: bonus._id },
            {
              $set: {
                recoveredAmount: recovery.recovered,
                outstandingAmount: recovery.outstanding,
              },
            },
            opts(session),
          );
        }
        bonusStatus = 'clawed_back';
      }

      return {
        cancelled: !!sale,
        entriesVoided,
        entriesReversed,
        bonusStatus,
      };
    });
  }

  async releaseEntry(entryId, adminId, now = new Date()) {
    if (!hasId(entryId)) throw new ValidationException('Invalid commission entry');
    const entry = await GrowthCommissionModel.findById(entryId).lean();
    if (!entry) throw new NotFoundException('Commission entry not found');
    if (entry.status === 'Released') {
      return { released: false, repeated: true, entry };
    }
    if (entry.status !== 'Pending') {
      throw new ConflictException(`Cannot release a ${String(entry.status).toLowerCase()} commission`);
    }

    return runInTransaction(async (session) => {
      const reference = `COM-${entry._id}`;
      const claimed = await GrowthCommissionModel.findOneAndUpdate(
        { _id: entry._id, status: 'Pending' },
        {
          $set: {
            status: 'Released',
            releasedBy: adminId,
            releasedAt: now,
            transactionReference: reference,
          },
        },
        opts(session, { new: true }),
      ).lean();
      if (!claimed) {
        const latest = await GrowthCommissionModel.findById(entry._id, null, opts(session)).lean();
        if (latest?.status === 'Released') return { released: false, repeated: true, entry: latest };
        throw new ConflictException('Commission can no longer be released');
      }

      const earner = await PartnersModel.findByIdAndUpdate(
        claimed.earnerId,
        { $inc: { balance: Number(claimed.amount) } },
        opts(session),
      ).lean();
      if (!earner) throw new NotFoundException('Commission earner not found');
      await TransactionModel.create(
        [{
          partnerId: claimed.earnerId,
          amount: claimed.amount,
          reference,
          status: 'Completed',
          paymentMethod: 'Growth Commission',
          transactionType: 'Credit',
          date: now,
          decidedBy: adminId,
          decidedAt: now,
          decisionNote: `Level ${claimed.level} commission`,
        }],
        opts(session),
      );

      return { released: true, repeated: false, entry: claimed };
    });
  }

  async voidEntry(entryId, adminId, reason) {
    if (!hasId(entryId)) throw new ValidationException('Invalid commission entry');
    const entry = await GrowthCommissionModel.findById(entryId).lean();
    if (!entry) throw new NotFoundException('Commission entry not found');
    if (entry.status === 'Voided') return { voided: false, repeated: true, entry };
    if (entry.status === 'Released') {
      throw new ConflictException('Released commissions need a reversal, not a void');
    }
    if (entry.status !== 'Pending') {
      throw new ConflictException(`Cannot void a ${String(entry.status).toLowerCase()} commission`);
    }
    const updated = await GrowthCommissionModel.findOneAndUpdate(
      { _id: entryId, status: 'Pending' },
      {
        $set: {
          status: 'Voided',
          voidedBy: adminId,
          voidedAt: new Date(),
          reversalReason: reason,
        },
      },
      { new: true },
    ).lean();
    if (!updated) throw new ConflictException('Commission can no longer be voided');
    return { voided: true, repeated: false, entry: updated };
  }

  async listMine(partnerId) {
    const partner = await PartnersModel.findById(partnerId)
      .select('name surname username email balance commissionRank placementParentId')
      .lean();
    if (!partner) throw new NotFoundException('Partner account not found');

    const [entries, totals, mentorBonuses] = await Promise.all([
      GrowthCommissionModel.find({ earnerId: partnerId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      GrowthCommissionModel.aggregate([
        { $match: { earnerId: partner._id } },
        { $group: { _id: '$status', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]).catch(() => []),
      MentorBonusModel.find({ mentorId: partnerId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    const ids = [
      ...entries.map((entry) => String(entry.partnerId)),
      ...mentorBonuses.map((bonus) => String(bonus.activationPartnerId)),
    ];
    const people = await PartnersModel.find({ _id: { $in: [...new Set(ids)] } })
      .select('name surname username')
      .lean();
    const peopleMap = new Map(people.map((row) => [String(row._id), row]));

    const totalMap = new Map(totals.map((row) => [row._id, Number(row.total) || 0]));
    const countMap = new Map(totals.map((row) => [row._id, Number(row.count) || 0]));

    return {
      partner: {
        id: String(partner._id),
        name: labelOf(partner),
        username: partner.username ?? '',
        balance: Number(partner.balance) || 0,
        commissionRank: normalizedRank(partner.commissionRank),
        depth: rankDepth(normalizedRank(partner.commissionRank)),
        placed: !!partner.placementParentId,
      },
      plan: planSummary(),
      summary: {
        pending: round(totalMap.get('Pending') ?? 0),
        released: round(totalMap.get('Released') ?? 0),
        pendingCount: countMap.get('Pending') ?? 0,
        releasedCount: countMap.get('Released') ?? 0,
        mentorPaid: round(mentorBonuses
          .filter((bonus) => ['paid', 'clawed_back'].includes(bonus.status))
          .reduce((sum, bonus) => sum + Math.max(
            Number(bonus.amount ?? 0) - Number(bonus.recoveredAmount ?? 0),
            0,
          ), 0)),
      },
      entries: entries.map((entry) => publicEntry(
        entry,
        partner,
        peopleMap.get(String(entry.partnerId)),
      )),
      mentorBonuses: mentorBonuses.map((bonus) => publicBonus(
        bonus,
        peopleMap.get(String(bonus.activationPartnerId)),
        partner,
      )),
    };
  }

  async listAdminEntries({ status, page = 1, limit = 25 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const filter = status ? { status } : {};
    const [rows, total] = await Promise.all([
      GrowthCommissionModel.find(filter)
        .sort({ status: 1, createdAt: 1 })
        .skip((current - 1) * size)
        .limit(size)
        .lean(),
      GrowthCommissionModel.countDocuments(filter),
    ]);
    const peopleIds = [...new Set(rows.flatMap((row) => [String(row.earnerId), String(row.partnerId)]))];
    const people = await PartnersModel.find({ _id: { $in: peopleIds } })
      .select('name surname username')
      .lean();
    const peopleMap = new Map(people.map((row) => [String(row._id), row]));
    return {
      data: rows.map((row) => publicEntry(
        row,
        peopleMap.get(String(row.earnerId)),
        peopleMap.get(String(row.partnerId)),
      )),
      meta: {
        page: current,
        limit: size,
        total,
        pages: Math.max(Math.ceil(total / size), 1),
      },
    };
  }

  async listAdminBonuses({ status, page = 1, limit = 25 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const filter = status ? { status } : {};
    const [rows, total] = await Promise.all([
      MentorBonusModel.find(filter)
        .sort({ dueAt: 1 })
        .skip((current - 1) * size)
        .limit(size)
        .lean(),
      MentorBonusModel.countDocuments(filter),
    ]);
    const peopleIds = [...new Set(rows.flatMap((row) => [
      String(row.activationPartnerId),
      ...(row.mentorId ? [String(row.mentorId)] : []),
    ]))];
    const people = await PartnersModel.find({ _id: { $in: peopleIds } })
      .select('name surname username')
      .lean();
    const peopleMap = new Map(people.map((row) => [String(row._id), row]));
    return {
      data: rows.map((row) => publicBonus(
        row,
        peopleMap.get(String(row.activationPartnerId)),
        row.mentorId ? peopleMap.get(String(row.mentorId)) : null,
      )),
      meta: {
        page: current,
        limit: size,
        total,
        pages: Math.max(Math.ceil(total / size), 1),
      },
    };
  }

  async setRank(identifier, rank) {
    const value = String(identifier ?? '').trim();
    if (!value) throw new ValidationException('Partner identifier is required');
    if (!RANKS.includes(rank)) throw new ValidationException('Invalid commission rank');
    const filter = hasId(value)
      ? { _id: value }
      : (value.includes('@')
        ? { email: value.toLowerCase() }
        : { username: value.toLowerCase().replace(/^@/, '') });
    const partner = await PartnersModel.findOneAndUpdate(
      filter,
      { $set: { commissionRank: rank } },
      { new: true },
    ).select('name surname username email commissionRank').lean();
    if (!partner) throw new NotFoundException('Partner not found');
    return {
      id: String(partner._id),
      name: labelOf(partner),
      username: partner.username ?? '',
      email: partner.email ?? '',
      commissionRank: normalizedRank(partner.commissionRank),
    };
  }

  async reconcileCompensation(now = new Date()) {
    const stats = { salesCreated: 0, allocationsAccrued: 0, mentorsAttached: 0, failed: 0 };
    const cutoff = new Date(now.getTime() - (120 * DAY_MS));

    const orders = await ActivationOrderModel.find({
      status: { $in: ['Paid', 'Fulfilled'] },
      grossMargin: { $gt: 0 },
      createdAt: { $gte: cutoff },
    }).select('_id partnerId orderNumber productName grossMargin activatedAt')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    const orderIds = orders.map((order) => order._id);
    const existing = orderIds.length
      ? await CommissionSaleModel.find({ orderId: { $in: orderIds } }).select('orderId').lean()
      : [];
    const existingOrders = new Set(existing.map((sale) => String(sale.orderId)));
    for (const order of orders) {
      if (existingOrders.has(String(order._id))) continue;
      try {
        await this.recordActivation({
          orderId: String(order._id),
          partnerId: String(order.partnerId),
          orderNumber: order.orderNumber,
          productName: order.productName,
          grossMargin: order.grossMargin,
          activatedAt: order.activatedAt,
        });
        stats.salesCreated += 1;
      } catch {
        stats.failed += 1;
      }
    }

    const pending = await CommissionSaleModel.find({ status: 'pending_placement' })
      .limit(200)
      .lean();
    for (const sale of pending) {
      try {
        const partner = await PartnersModel.findById(sale.partnerId)
          .select('placementParentId')
          .lean();
        if (!partner?.placementParentId) continue;
        const results = await this.handleAllocation({
          partnerId: sale.partnerId,
          ownerId: partner.placementParentId,
          campaignId: null,
        });
        if (results.length > 0) stats.allocationsAccrued += 1;
      } catch {
        stats.failed += 1;
      }
    }

    const unassigned = await MentorBonusModel.find({
      status: 'scheduled',
      mentorId: null,
    }).limit(200).lean();
    for (const bonus of unassigned) {
      try {
        const partner = await PartnersModel.findById(bonus.activationPartnerId)
          .select('placementParentId')
          .lean();
        if (!partner?.placementParentId) continue;
        const updated = await MentorBonusModel.updateOne(
          { _id: bonus._id, status: 'scheduled', mentorId: null },
          { $set: { mentorId: partner.placementParentId } },
        );
        if (updated.modifiedCount > 0) stats.mentorsAttached += 1;
      } catch {
        stats.failed += 1;
      }
    }

    return stats;
  }

  async runMentorBonuses(now = new Date()) {
    const due = await MentorBonusModel.find({
      status: 'scheduled',
      mentorId: { $ne: null },
      dueAt: { $lte: now },
    }).sort({ dueAt: 1 }).limit(100).lean();

    const result = { checked: due.length, paid: 0, forfeited: 0, held: 0, failed: 0 };
    for (const bonus of due) {
      try {
        const outcome = await this.payMentorBonus(bonus._id, now);
        if (outcome.status === 'paid') result.paid += 1;
        else if (outcome.status === 'forfeited') result.forfeited += 1;
        else if (outcome.status === 'held') result.held += 1;
      } catch {
        result.failed += 1;
      }
    }

    const expired = await MentorBonusModel.updateMany(
      {
        status: 'scheduled',
        mentorId: null,
        expiresAt: { $lt: now },
      },
      {
        $set: {
          status: 'forfeited',
          note: 'No mentor placement before expiry',
        },
      },
    );
    result.forfeited += expired.modifiedCount ?? 0;
    return result;
  }

  async payMentorBonus(bonusId, now = new Date()) {
    const bonus = await MentorBonusModel.findById(bonusId).lean();
    if (!bonus || bonus.status !== 'scheduled') return { status: 'skipped' };
    if (!bonus.mentorId) return { status: 'held' };
    if (new Date(bonus.expiresAt) < now) {
      await MentorBonusModel.updateOne(
        { _id: bonus._id, status: 'scheduled' },
        { $set: { status: 'forfeited', note: 'Bonus expired before placement' } },
      );
      return { status: 'forfeited' };
    }

    const [activation, mentor] = await Promise.all([
      PartnersModel.findById(bonus.activationPartnerId)
        .select('accountState suspendedAt')
        .lean(),
      PartnersModel.findById(bonus.mentorId)
        .select('accountState kycStatus suspendedAt')
        .lean(),
    ]);
    if (!activation || activation.accountState !== 'partner' || activation.suspendedAt) {
      await MentorBonusModel.updateOne(
        { _id: bonus._id, status: 'scheduled' },
        { $set: { status: 'forfeited', note: 'Activation is no longer valid' } },
      );
      return { status: 'forfeited' };
    }
    if (!mentor
      || mentor.accountState !== 'partner'
      || mentor.suspendedAt
      || (mentor.kycStatus ?? 'verified') !== 'verified') {
      await MentorBonusModel.updateOne(
        { _id: bonus._id, status: 'scheduled' },
        { $set: { status: 'forfeited', note: 'Mentor is not active/qualified' } },
      );
      return { status: 'forfeited' };
    }

    return runInTransaction(async (session) => {
      const reference = `MB-${bonus._id}`;
      const claimed = await MentorBonusModel.findOneAndUpdate(
        { _id: bonus._id, status: 'scheduled' },
        {
          $set: {
            status: 'paid',
            paidAt: now,
            transactionReference: reference,
          },
        },
        opts(session, { new: true }),
      ).lean();
      if (!claimed) return { status: 'skipped' };

      await PartnersModel.findByIdAndUpdate(
        bonus.mentorId,
        { $inc: { balance: Number(bonus.amount) } },
        opts(session),
      );
      await TransactionModel.create(
        [{
          partnerId: bonus.mentorId,
          amount: bonus.amount,
          reference,
          status: 'Completed',
          paymentMethod: 'Activation Mentor Bonus',
          transactionType: 'Credit',
          date: now,
          decisionNote: 'Day-7 activation mentor bonus',
        }],
        opts(session),
      );
      return { status: 'paid' };
    });
  }

  async clawbackEarner({ earnerId, amount, reference, note, session, now }) {
    const target = Math.max(Number(amount) || 0, 0);
    if (!hasId(earnerId) || target <= 0) {
      return { recovered: 0, outstanding: target };
    }
    const earner = await PartnersModel.findById(earnerId, 'balance', opts(session)).lean();
    if (!earner) return { recovered: 0, outstanding: target };
    const recovered = Math.min(Math.max(Number(earner.balance) || 0, 0), target);
    if (recovered > 0) {
      const debited = await PartnersModel.updateOne(
        { _id: earnerId, balance: { $gte: recovered } },
        { $inc: { balance: -recovered } },
        opts(session),
      );
      if (debited.modifiedCount > 0) {
        await TransactionModel.create(
          [{
            partnerId: earnerId,
            amount: recovered,
            reference,
            status: 'Completed',
            paymentMethod: 'Commission Reversal',
            transactionType: 'Debit',
            date: now,
            decisionNote: note,
          }],
          opts(session),
        );
        return { recovered: round(recovered), outstanding: round(target - recovered) };
      }
    }
    return { recovered: 0, outstanding: round(target) };
  }
}

export { commissionAmount, planSummary, rankDepth, rateForLevel };
