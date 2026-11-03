import { ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { createNotificationEntity, createPreferencesEntity, resolvePreferences } from '../domain/StoredNotifications.js';

/**
 * Producer API (no HTTP create — stored items are written server-side only).
 * Duplicate suppression: a racing/duplicate keyed write (E11000 on the
 * unique (recipientId, key)) resolves to the existing row with
 * `{deduped: true}` instead of throwing — reruns never double-notify.
 */
export class NotifyUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ recipientId, ...input }) {
    const data = { ...createNotificationEntity(input), recipientId };
    try {
      return await this.stored.create(data);
    } catch (error) {
      if (data.key && (error?.code === 11000 || /duplicate key/i.test(error?.message ?? ''))) {
        const existing = await this.stored.findByKey(recipientId, data.key);
        if (existing) return { ...existing, deduped: true };
      }
      throw error;
    }
  }
}

const asStoredItem = (row) => ({
  id: String(row.id),
  kind: row.category,
  category: row.category,
  key: row.key ?? null,
  priority: row.priority,
  urgency: row.priority === 'critical',
  title: row.title,
  body: row.body,
  icon: row.icon ?? 'notifications',
  tag: row.category,
  link: row.link ?? null,
  at: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
  origin: 'stored',
  read: row.readAt !== null && row.readAt !== undefined,
});

const asDerivedItem = (item) => ({ ...item, origin: 'derived', read: false });

/**
 * Unified center list: stored items (filterable, searchable, paged) plus
 * the derived feed section. Derived ids are marked so the UI only offers
 * archive/delete on stored rows (derived rejects with 400).
 */
export class ListCenterUseCase {
  /** @param {{stored, feed}} deps */
  constructor({ stored, feed }) {
    Object.assign(this, { stored, feed });
  }

  async execute({ partnerId, unreadOnly = false, search = '', cursor = null, limit = 50 }) {
    const [stored, derived] = await Promise.all([
      this.stored.list(partnerId, { unreadOnly, search, cursor, limit }),
      unreadOnly || search || cursor
        ? []
        : this.feed.execute({ partnerId, limit: 50 }).then((f) => f.items ?? []),
    ]);
    const items = stored.items.map(asStoredItem);
    // N4: a stored mention supersedes its derived twin (`mention:<type>:<id>`
    // prefix of the stored `mention:<type>:<id>:<handle>` key) — one row per event.
    const superseded = new Set(
      items
        .map((i) => i.key)
        .filter((k) => typeof k === 'string' && k.startsWith('mention:'))
        .map((k) => k.split(':').slice(0, 3).join(':')),
    );
    return {
      stored: items,
      derived: (derived ?? [])
        .filter((d) => !(d.kind === 'mention' && superseded.has(d.id)))
        .map(asDerivedItem),
      hasMore: stored.hasMore,
    };
  }
}

const assertOwned = (row, partnerId, what = 'Notification') => {
  if (!row) throw new NotFoundException(`${what} not found`);
  if (String(row.recipientId) !== String(partnerId)) throw new ForbiddenException('Not your notification');
  return row;
};

export class MarkStoredReadUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, id }) {
    const row = await this.stored.findById(id);
    assertOwned(row, partnerId);
    return this.stored.markRead(partnerId, id);
  }
}

export class ArchiveNotificationUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, id }) {
    const row = await this.stored.findById(id);
    assertOwned(row, partnerId);
    return this.stored.archive(partnerId, id);
  }
}

export class RemoveNotificationUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, id }) {
    const row = await this.stored.findById(id);
    assertOwned(row, partnerId);
    return this.stored.remove(partnerId, id);
  }
}

export class BulkCenterUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, action }) {
    if (action === 'read-all') return this.stored.markAllRead(partnerId);
    if (action === 'delete-all') return this.stored.deleteAll(partnerId);
    return this.stored.archiveAll(partnerId);
  }
}

export class GetPreferencesUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId }) {
    return resolvePreferences(await this.stored.getPreferences(partnerId));
  }
}

export class UpdatePreferencesUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, prefs }) {
    const saved = await this.stored.savePreferences(partnerId, createPreferencesEntity(prefs));
    return resolvePreferences(saved);
  }
}

export class MarkStoredUnreadUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, id }) {
    const row = await this.stored.findById(id);
    assertOwned(row, partnerId);
    return this.stored.markUnread(partnerId, id);
  }
}

/** Click beacon for engagement analytics (implies read). */
export class RecordClickUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, id }) {
    const row = await this.stored.findById(id);
    assertOwned(row, partnerId);
    return this.stored.recordClick(partnerId, id);
  }
}

/**
 * Engagement analytics: delivery / read / click / engagement rates
 * overall + per category over the trailing window (default 30d).
 */
export class NotificationStatsUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, days = 30, now = new Date() }) {
    const windowDays = Math.min(Math.max(Number(days) || 30, 1), 90);
    const since = new Date(new Date(now).getTime() - windowDays * 86400000);
    const perCategory = await this.stored.engagementStats(partnerId, since);
    const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
    // Clicks imply reads, so engagement (read OR clicked) equals the read
    // rate by construction; click rate measures depth below it.
    const withRates = perCategory.map((c) => ({
      ...c,
      readRate: rate(c.read, c.sent),
      clickRate: rate(c.clicked, c.sent),
      engagementRate: rate(c.read, c.sent),
    }));
    const totals = withRates.reduce(
      (acc, c) => ({
        sent: acc.sent + c.sent,
        read: acc.read + c.read,
        clicked: acc.clicked + c.clicked,
        email: acc.email + c.channels.email,
        sms: acc.sms + c.channels.sms,
        push: acc.push + c.channels.push,
      }),
      { sent: 0, read: 0, clicked: 0, email: 0, sms: 0, push: 0 },
    );
    return {
      days: windowDays,
      totals: {
        ...totals,
        readRate: rate(totals.read, totals.sent),
        clickRate: rate(totals.clicked, totals.sent),
        engagementRate: rate(totals.read, totals.sent),
      },
      perCategory: withRates,
    };
  }
}

const pushSubSchema = (input = {}) => {
  const endpoint = String(input.endpoint ?? '').trim();
  const p256dh = String(input.keys?.p256dh ?? input.p256dh ?? '').trim();
  const auth = String(input.keys?.auth ?? input.auth ?? '').trim();
  if (!/^https?:\/\//.test(endpoint) || endpoint.length > 2000) {
    throw new ValidationException('Invalid push endpoint');
  }
  if (!p256dh || !auth) throw new ValidationException('Invalid push keys');
  return { endpoint, p256dh, auth, userAgent: String(input.userAgent ?? '').slice(0, 500) || null };
};

export class SavePushSubscriptionUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, subscription }) {
    return this.stored.saveSubscription(partnerId, pushSubSchema(subscription));
  }
}

export class RemovePushSubscriptionUseCase {
  /** @param {{stored}} deps */
  constructor({ stored }) {
    this.stored = stored;
  }

  async execute({ partnerId, endpoint }) {
    return this.stored.removeSubscription(partnerId, String(endpoint ?? ''));
  }
}
