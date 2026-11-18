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

/** GET (admin) — aggregate delivery performance across recent campaigns. */
export class BroadcastSummaryUseCase {
  constructor({ broadcasts } = {}) {
    this.broadcasts = broadcasts ?? BroadcastModel;
  }

  async execute({ days = 30 } = {}) {
    const windowDays = Math.min(Math.max(Number(days) || 30, 1), 365);
    const from = new Date(Date.now() - windowDays * 86400000);
    const rows = await this.broadcasts
      .find({ createdAt: { $gte: from } })
      .select('status stats audience createdAt')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();
    const summary = {
      campaigns: rows.length,
      sent: 0,
      scheduled: 0,
      sending: 0,
      failed: 0,
      cancelled: 0,
      inAppSent: 0,
      inAppFailed: 0,
      emailSent: 0,
      emailFailed: 0,
      smsSent: 0,
      smsFailed: 0,
      smsSpend: 0,
      platform: 0,
      customers: 0,
      members: 0,
      partners: 0,
    };
    for (const row of rows) {
      if (row.status && Object.hasOwn(summary, row.status)) summary[row.status] += 1;
      const stats = row.stats ?? {};
      summary.inAppSent += Number(stats.inApp?.sent) || 0;
      summary.inAppFailed += Number(stats.inApp?.failed) || 0;
      summary.emailSent += Number(stats.email?.sent) || 0;
      summary.emailFailed += Number(stats.email?.failed) || 0;
      summary.smsSent += Number(stats.sms?.sent) || 0;
      summary.smsFailed += Number(stats.sms?.failed) || 0;
      summary.smsSpend += Number(stats.estimatedSmsSpend) || 0;
      if (row.audience?.source === 'customers') summary.customers += 1;
      else summary.platform += 1;
      if (row.audience?.accountState === 'member') summary.members += 1;
      if (row.audience?.accountState === 'partner') summary.partners += 1;
    }
    return {
      windowDays,
      campaigns: summary.campaigns,
      status: {
        sent: summary.sent,
        scheduled: summary.scheduled,
        sending: summary.sending,
        failed: summary.failed,
        cancelled: summary.cancelled,
      },
      delivery: {
        inApp: { sent: summary.inAppSent, failed: summary.inAppFailed },
        email: { sent: summary.emailSent, failed: summary.emailFailed },
        sms: { sent: summary.smsSent, failed: summary.smsFailed },
      },
      smsSpend: summary.smsSpend,
      audiences: { platform: summary.platform, customers: summary.customers },
      activation: { members: summary.members, partners: summary.partners },
    };
  }
}

export class ListBroadcastsUseCase {
  /** @param {{broadcasts}} deps */
  constructor({ broadcasts } = {}) {
    this.broadcasts = broadcasts ?? BroadcastModel;
  }

  async execute({ limit = 25, skip = 0, status = null, kind = null, q = null, channel = null, source = null, accountState = null } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const filter = {};
    if (['sending', 'sent', 'scheduled', 'failed', 'cancelled'].includes(status)) filter.status = status;
    if (['system', 'marketing'].includes(kind)) filter.kind = kind;
    const and = [];
    if (['sms', 'email', 'inApp'].includes(channel)) {
      and.push({ [`channels.${channel}`]: true });
    }
    if (source === 'customers') {
      and.push({ 'audience.source': 'customers' });
    } else if (source === 'platform') {
      and.push({
        $or: [
          { 'audience.source': 'platform' },
          { audience: null },
          { 'audience.source': { $exists: false } },
        ],
      });
    }
    if (['member', 'partner'].includes(accountState)) {
      and.push({ 'audience.accountState': accountState });
    }
    if (and.length) filter.$and = and;
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
        audience: d.audience ?? { mode: 'all', source: 'platform', accountState: 'all' },
        source: d.audience?.source ?? 'platform',
        accountState: d.audience?.accountState ?? 'all',
      })),
      total,
      limit: lim,
      skip: sk,
    };
  }
}
