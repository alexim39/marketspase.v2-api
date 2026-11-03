import { BROADCAST_CAP, createBroadcastInput } from '../domain/Broadcast.js';
import { BroadcastModel } from '../infrastructure/Broadcast.mongo.model.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';

/**
 * Send a platform-wide in-app notice. Writes one stored row per partner
 * (bounded by BROADCAST_CAP, oldest-first by _id for determinism), keyed
 * `broadcast:<id>` so reruns dedupe instead of double-notifying.
 * In-app only — email-at-scale stays out until a queued mailer exists.
 */
export class SendBroadcastUseCase {
  /** @param {{partners, broadcasts, notify}} deps */
  constructor({ partners, broadcasts, notify }) {
    Object.assign(this, {
      partners: partners ?? PartnersModel,
      broadcasts: broadcasts ?? BroadcastModel,
      notify,
    });
  }

  async execute({ createdBy, title, body, link = null, priority = 'high' }) {
    const input = createBroadcastInput({ title, body, link, priority });
    const doc = await this.broadcasts.create({ ...input, createdBy: String(createdBy) });
    const broadcastId = String(doc._id);

    const ids = await this.partners
      .find({})
      .select('_id')
      .sort({ _id: 1 })
      .limit(BROADCAST_CAP + 1)
      .lean();
    const capped = ids.length > BROADCAST_CAP;
    const targets = ids.slice(0, BROADCAST_CAP);

    let delivered = 0;
    // Sequential — one shared connection, backpressure-safe; 5k keyed
    // writes is seconds, and failures are counted, never thrown.
    let failed = 0;
    for (const t of targets) {
      try {
        await this.notify.execute({
          recipientId: String(t._id),
          category: 'system',
          priority: input.priority,
          title: input.title,
          body: input.body,
          icon: 'campaign',
          link: input.link,
          key: `broadcast:${broadcastId}`,
        });
        delivered += 1;
      } catch {
        failed += 1;
      }
    }
    await this.broadcasts.updateOne(
      { _id: doc._id },
      { $set: { recipientCount: delivered, capped } },
    );
    return {
      id: broadcastId,
      delivered,
      failed,
      capped,
      total: targets.length,
    };
  }
}

/** GET (admin) — broadcast history, newest first, filterable for scale. */
export class ListBroadcastsUseCase {
  /** @param {{broadcasts}} deps */
  constructor({ broadcasts } = {}) {
    this.broadcasts = broadcasts ?? BroadcastModel;
  }

  async execute({ limit = 25, skip = 0, status = null, kind = null, q = null } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const filter = {};
    if (['sending', 'sent', 'scheduled', 'failed', 'cancelled'].includes(status)) filter.status = status;
    if (['system', 'marketing'].includes(kind)) filter.kind = kind;
    const needle = String(q ?? '').trim().slice(0, 120);
    if (needle) {
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { body: rx }];
    }
    const [docs, total] = await Promise.all([
      this.broadcasts.find(filter).sort({ createdAt: -1 }).skip(sk).limit(lim).lean(),
      this.broadcasts.countDocuments(filter),
    ]);
    return {
      items: docs.map((d) => ({
        id: String(d._id),
        title: d.title,
        body: String(d.body ?? '').slice(0, 280),
        link: d.link ?? null,
        priority: d.priority ?? 'high',
        createdBy: d.createdBy ? String(d.createdBy) : null,
        recipientCount: d.recipientCount ?? 0,
        capped: !!d.capped,
        createdAt: d.createdAt ?? null,
        // v2 campaign fields (absent on legacy in-app rows)
        channels: d.channels ?? null,
        kind: d.kind ?? null,
        status: d.status ?? null,
        stats: d.stats ?? null,
        sendAt: d.sendAt ?? null,
        estimatedSmsSpend: d.estimatedSmsSpend ?? null,
      })),
      total,
      limit: lim,
      skip: sk,
    };
  }
}
