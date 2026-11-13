import mongoose from 'mongoose';
import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { StoreCustomerLeadModel } from './Store.models.js';

const hasId = (value) => /^[a-fA-F0-9]{24}$/.test(String(value ?? ''));
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const statusCounts = (rows) => Object.fromEntries((rows ?? []).map((row) => [row._id, row.count]));

const toPublic = (row) => ({
  id: String(row._id),
  name: row.name ?? '',
  email: row.email ?? '',
  phone: row.phone ?? '',
  street: row.street ?? '',
  city: row.city ?? '',
  state: row.state ?? '',
  country: row.country ?? '',
  note: row.note ?? '',
  consentToContact: row.consentToContact === true,
  status: row.status ?? 'New',
  partnerNotes: row.partnerNotes ?? '',
  tags: row.tags ?? [],
  checkoutCount: Number(row.checkoutCount) || 0,
  paidOrders: Number(row.paidOrders) || 0,
  refundedOrders: Number(row.refundedOrders) || 0,
  totalSpent: round((Number(row.totalSpentKobo) || 0) / 100),
  firstSeenAt: row.firstSeenAt ?? null,
  lastCheckoutAt: row.lastCheckoutAt ?? null,
  lastPaidAt: row.lastPaidAt ?? null,
  lastOutreachAt: row.lastOutreachAt ?? null,
  lastOutreachChannel: row.lastOutreachChannel ?? '',
  outreachCount: Number(row.outreachCount) || 0,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

const escape = (value) => String(value ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class StoreCustomerLeadRepository {
  async list(partnerId, { q = '', status = null, segment = 'all', limit = 50, skip = 0 } = {}) {
    if (!hasId(partnerId)) throw new ValidationException('Invalid partner');
    const pid = new mongoose.Types.ObjectId(partnerId);
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const sk = Math.max(Number(skip) || 0, 0);
    const filter = { partnerId: pid };
    if (status) filter.status = String(status);
    const needle = String(q ?? '').trim();
    if (needle) {
      const rx = new RegExp(escape(needle), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { city: rx }, { state: rx }];
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const dormantBefore = new Date(Date.now() - 60 * 86400000);

    const segmentFilters = {
      new: { paidOrders: { $lte: 1 } },
      repeat: { paidOrders: { $gte: 2 } },
      dormant: { paidOrders: { $gte: 1 }, lastPaidAt: { $lte: dormantBefore } },
      loyal: { paidOrders: { $gte: 3 } },
    };
    if (segment && segment !== 'all' && segmentFilters[segment]) {
      Object.assign(filter, segmentFilters[segment]);
    }

    const [rows, total, summaryRows, statusRows, newThisMonth, repeatCustomers, dormantCustomers, loyalCustomers, newCustomers] = await Promise.all([
      StoreCustomerLeadModel.find(filter).sort({ lastCheckoutAt: -1 }).skip(sk).limit(lim).lean(),
      StoreCustomerLeadModel.countDocuments(filter),
      StoreCustomerLeadModel.aggregate([
        { $match: { partnerId: pid } },
        { $group: { _id: null, revenueKobo: { $sum: '$totalSpentKobo' }, paidOrders: { $sum: '$paidOrders' } } },
      ]),
      StoreCustomerLeadModel.aggregate([
        { $match: { partnerId: pid } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      StoreCustomerLeadModel.countDocuments({ partnerId: pid, firstSeenAt: { $gte: monthStart } }),
      StoreCustomerLeadModel.countDocuments({ partnerId: pid, paidOrders: { $gte: 2 } }),
      StoreCustomerLeadModel.countDocuments({ partnerId: pid, ...segmentFilters.dormant }),
      StoreCustomerLeadModel.countDocuments({ partnerId: pid, ...segmentFilters.loyal }),
      StoreCustomerLeadModel.countDocuments({ partnerId: pid, ...segmentFilters.new }),
    ]);

    return {
      items: rows.map(toPublic),
      total,
      summary: {
        totalLeads: await StoreCustomerLeadModel.countDocuments({ partnerId: pid }),
        repeatCustomers,
        paidOrders: Number(summaryRows?.[0]?.paidOrders ?? 0),
        revenue: round((Number(summaryRows?.[0]?.revenueKobo ?? 0)) / 100),
        newThisMonth,
        segments: {
          new: newCustomers,
          repeat: repeatCustomers,
          dormant: dormantCustomers,
          loyal: loyalCustomers,
        },
      },
      statusCounts: statusCounts(statusRows),
    };
  }

  async update(partnerId, id, patch = {}) {
    if (!hasId(partnerId) || !hasId(id)) throw new ValidationException('Invalid customer');
    const update = {};
    if (patch.status !== undefined) {
      const statuses = ['New', 'Contacted', 'Qualified', 'Converted', 'Closed'];
      if (!statuses.includes(patch.status)) throw new ValidationException('Invalid customer status');
      update.status = patch.status;
    }
    if (patch.partnerNotes !== undefined) {
      update.partnerNotes = String(patch.partnerNotes ?? '').trim().slice(0, 2000);
    }
    if (patch.tags !== undefined) {
      update.tags = [...new Set((Array.isArray(patch.tags) ? patch.tags : [])
        .map((tag) => String(tag ?? '').trim().slice(0, 40))
        .filter(Boolean))].slice(0, 12);
    }
    if (Object.keys(update).length === 0) throw new ValidationException('Nothing to update');

    const row = await StoreCustomerLeadModel.findOneAndUpdate(
      { _id: id, partnerId },
      { $set: update },
      { new: true },
    ).lean();
    if (!row) throw new NotFoundException('Customer not found');
    return toPublic(row);
  }

  async recordOutreach(partnerId, id, channel) {
    if (!hasId(partnerId) || !hasId(id)) throw new ValidationException('Invalid customer');
    const allowed = ['whatsapp', 'email', 'call'];
    const value = String(channel ?? '').trim().toLowerCase();
    if (!allowed.includes(value)) throw new ValidationException('Invalid outreach channel');
    const row = await StoreCustomerLeadModel.findOneAndUpdate(
      { _id: id, partnerId },
      {
        $set: { lastOutreachAt: new Date(), lastOutreachChannel: value },
        $inc: { outreachCount: 1 },
      },
      { new: true },
    ).lean();
    if (!row) throw new NotFoundException('Customer not found');
    return toPublic(row);
  }
}
