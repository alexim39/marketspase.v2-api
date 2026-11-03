import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { EmailSubscriptionModel } from '../../../apps/email-subscription/models/email-subscription.model.js';

const STATUSES = ['Subscribed', 'Unsubscribed'];

const shape = (d) => ({
  id: String(d._id),
  email: d.email ?? '',
  status: d.status ?? 'Subscribed',
  userDevice: d.userDevice ?? '',
  username: d.username ?? '',
  createdAt: d.createdAt ?? null,
});

/**
 * GET /v1/admin/subscriptions — admin email-list desk (searchable,
 * filterable, paginated + summary KPIs in one round trip).
 */
export class ListSubscriptionsUseCase {
  /** @param {{subscriptions}} deps */
  constructor({ subscriptions } = {}) {
    this.subscriptions = subscriptions ?? EmailSubscriptionModel;
  }

  async execute({ q = null, status = null, limit = 25, skip = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const filter = {};
    const needle = String(q ?? '').trim().slice(0, 120);
    if (needle) {
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ email: rx }, { username: rx }, { userDevice: rx }];
    }
    if (STATUSES.includes(status)) filter.status = status;
    const [rows, total, summary] = await Promise.all([
      this.subscriptions.find(filter).sort({ createdAt: -1 }).skip(sk).limit(lim).lean().catch(() => []),
      this.subscriptions.countDocuments(filter).catch(() => 0),
      this.subscriptions.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            subscribed: { $sum: { $cond: [{ $eq: ['$status', 'Subscribed'] }, 1, 0] } },
            unsubscribed: { $sum: { $cond: [{ $ne: ['$status', 'Subscribed'] }, 1, 0] } },
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
      items: (rows ?? []).map(shape),
      total,
      summary: {
        total: s.total ?? 0,
        subscribed: s.subscribed ?? 0,
        unsubscribed: s.unsubscribed ?? 0,
        new7d: s.new7d ?? 0,
      },
    };
  }
}

/**
 * PATCH /v1/admin/subscriptions/:id — flip Subscribed/Unsubscribed.
 * Softer than delete: keeps the record for re-engagement history.
 */
export class SetSubscriptionStatusUseCase {
  /** @param {{subscriptions}} deps */
  constructor({ subscriptions } = {}) {
    this.subscriptions = subscriptions ?? EmailSubscriptionModel;
  }

  async execute({ id, status }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid subscription id');
    if (!STATUSES.includes(status)) throw new ValidationException('Status must be Subscribed or Unsubscribed');
    const doc = await this.subscriptions.findByIdAndUpdate(
      id, { $set: { status } }, { new: true },
    ).lean().catch(() => null);
    if (!doc) throw new NotFoundException('Subscription not found');
    return shape(doc);
  }
}

/**
 * DELETE /v1/admin/subscriptions/:id — hard delete one row.
 * Email-list rows are pre-relationship data (no wallet, no pipeline);
 * deleting removes the row only. Audited at the route.
 */
export class DeleteSubscriptionUseCase {
  /** @param {{subscriptions}} deps */
  constructor({ subscriptions } = {}) {
    this.subscriptions = subscriptions ?? EmailSubscriptionModel;
  }

  async execute({ id }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid subscription id');
    const doc = await this.subscriptions.findById(id).lean().catch(() => null);
    if (!doc) throw new NotFoundException('Subscription not found');
    await this.subscriptions.deleteOne({ _id: id }).catch(() => null);
    return { id: String(id), email: doc.email ?? '' };
  }
}

/**
 * GET /v1/admin/subscriptions/export — same filters, no pagination
 * (cap 5000) for the desk's CSV download.
 */
export class ExportSubscriptionsUseCase {
  /** @param {{subscriptions, max?}} deps */
  constructor({ subscriptions, max = 5000 } = {}) {
    Object.assign(this, {
      subscriptions: subscriptions ?? EmailSubscriptionModel,
      max: Math.min(Math.max(Number(max) || 5000, 1), 10000),
    });
  }

  async execute({ q = null, status = null } = {}) {
    const filter = {};
    const needle = String(q ?? '').trim().slice(0, 120);
    if (needle) {
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ email: rx }, { username: rx }, { userDevice: rx }];
    }
    if (STATUSES.includes(status)) filter.status = status;
    const rows = await this.subscriptions.find(filter).sort({ createdAt: -1 }).limit(this.max).lean().catch(() => []);
    return { items: (rows ?? []).map(shape), total: (rows ?? []).length, capped: (rows ?? []).length >= this.max };
  }
}
