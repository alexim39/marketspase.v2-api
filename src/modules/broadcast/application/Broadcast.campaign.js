import { ConflictException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import {
  BROADCAST_CAP, createCampaignInput, estimateSmsSpend, smsPages,
} from '../domain/Broadcast.js';
import { BroadcastModel } from '../infrastructure/Broadcast.mongo.model.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { resolvePreferences } from '../../notifications/domain/StoredNotifications.js';
import { resolveChannels, plainEmailHtml } from '../../notifications/domain/Delivery.js';
import { NotificationPreferenceModel, StoredNotificationModel } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { sendEmail } from '../../../services/emailService.js';
import { buildSmsSender } from '../../notifications/infrastructure/SmsSender.js';
import { env } from '../../../shared/config/env.js';

const MEMBER_FIELDS = 'name surname email phone username';

const safeMember = (d) => ({
  id: String(d._id),
  name: [d.name, d.surname].filter(Boolean).join(' ') || d.username,
  email: d.email ?? null,
  phone: d.phone ?? null,
});

/**
 * Turn an audience spec into a concrete member list (bounded by
 * BROADCAST_CAP). Suspended partners never receive broadcasts — their
 * inbox is unreachable and off-app sends would be pure spend.
 */
export const resolveAudience = async ({ partners }, audience, cap = BROADCAST_CAP) => {
  const lim = cap + 1;
  let docs;
  if (audience.mode === 'picked') {
    docs = await partners
      .find({ _id: { $in: audience.ids.slice(0, lim) } })
      .select(MEMBER_FIELDS)
      .lean();
  } else {
    const filter = {};
    if (audience.mode === 'segment') {
      const seg = audience.segment ?? {};
      if (seg.role) filter.role = new RegExp(`^${seg.role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      if (seg.active === true) filter.status = true;
      if (seg.active === false) filter.status = false;
      if (seg.joinedAfter) filter.createdAt = { ...(filter.createdAt ?? {}), $gte: seg.joinedAfter };
      if (seg.joinedBefore) filter.createdAt = { ...(filter.createdAt ?? {}), $lte: seg.joinedBefore };
      if (seg.excludeSuspended !== false) filter.suspendedAt = null;
    } else {
      filter.suspendedAt = null;
    }
    docs = await partners
      .find(filter)
      .select(MEMBER_FIELDS)
      .sort({ _id: 1 })
      .limit(lim)
      .lean();
  }
  // Suspended filter for picked mode (explicit ids still respect lockout).
  const eligible = (docs ?? []).filter((d) => d.suspendedAt === undefined || d.suspendedAt === null);
  const capped = eligible.length > cap;
  return { members: eligible.slice(0, cap).map(safeMember), capped, total: Math.min(eligible.length, cap) };
};

const prefsMap = async (prefModel, ids) => {
  if (!ids.length) return new Map();
  const docs = await prefModel.find({ partnerId: { $in: ids } }).lean().catch(() => []);
  return new Map((docs ?? []).map((d) => [String(d.partnerId), resolvePreferences(d)]));
};

/**
 * Split members per channel. `system` reaches everyone (urgent semantic,
 * same as v1 in-app); `marketing` honors each member's channel prefs —
 * email additionally requires an immediate digest (batched-digest members
 * chose not to be mailed one-offs).
 */
export const splitChannels = (members, prefs, kind, channels) => {
  const out = { inApp: [], email: [], sms: [] };
  for (const m of members) {
    if (channels.inApp) {
      if (kind === 'system') out.inApp.push(m);
      else if (resolveChannels({ prefs: prefs.get(m.id), category: 'marketing' }).inApp) out.inApp.push(m);
    }
    if (channels.email && m.email) {
      if (kind === 'system') out.email.push(m);
      else if (resolveChannels({ prefs: prefs.get(m.id), category: 'marketing', emailPolicy: 'immediate-only' }).email) {
        out.email.push(m);
      }
    }
    if (channels.sms && m.phone) {
      if (kind === 'system') out.sms.push(m);
      else if (resolveChannels({ prefs: prefs.get(m.id), category: 'marketing' }).sms) out.sms.push(m);
    }
  }
  return out;
};

/** POST estimate — audience counts + gateway-spend preview, zero sends. */
export class EstimateAudienceUseCase {
  /** @param {{partners, prefs}} deps */
  constructor({ partners, prefs } = {}) {
    Object.assign(this, {
      partners: partners ?? PartnersModel,
      prefs: prefs ?? NotificationPreferenceModel,
    });
  }

  async execute({ audience, channels, kind = 'system', smsBody = '' }) {
    const { members, capped } = await resolveAudience({ partners: this.partners }, audience);
    const map = await prefsMap(this.prefs, members.map((m) => m.id));
    const split = splitChannels(members, map, kind, channels);
    return {
      total: members.length,
      capped,
      inApp: split.inApp.length,
      email: split.email.length,
      sms: split.sms.length,
      smsPages: channels.sms ? smsPages(smsBody) : 0,
      estimatedSmsSpend: channels.sms ? estimateSmsSpend(split.sms.length, smsBody) : 0,
    };
  }
}

/** POST campaign — validate, store as scheduled, worker fires when due. */
export class ScheduleCampaignUseCase {
  /** @param {{broadcasts}} deps */
  constructor({ broadcasts } = {}) {
    this.broadcasts = broadcasts ?? BroadcastModel;
  }

  async execute({ createdBy, input }) {
    const clean = createCampaignInput(input ?? {});
    const doc = await this.broadcasts.create({
      title: clean.title,
      body: clean.body,
      link: clean.link,
      priority: clean.priority,
      subject: clean.subject,
      smsBody: clean.smsBody,
      channels: clean.channels,
      kind: clean.kind,
      audience: clean.audience,
      sendAt: clean.sendAt ?? new Date(),
      status: 'scheduled',
      createdBy: String(createdBy),
    });
    return { id: String(doc._id), status: 'scheduled', sendAt: doc.sendAt };
  }
}

/**
 * Minute-worker fan-out — claims due rows atomically (scheduled →
 * sending) so parallel dynos never double-blast, then sends per channel.
 * SMS here is platform-funded by product decision (gateway wallet only,
 * no member/admin debit) — the confirm screen + caps + audit are the
 * brakes, not a wallet charge. Failures counted per channel, never thrown.
 */
export class RunBroadcastDueUseCase {
  /** @param {{broadcasts, partners, prefs, notify, mail, sms, appBaseUrl, batch?}} deps */
  constructor({ broadcasts, partners, prefs, notify, mail, sms, appBaseUrl = null, batch = 5 } = {}) {
    Object.assign(this, {
      broadcasts: broadcasts ?? BroadcastModel,
      partners: partners ?? PartnersModel,
      prefs: prefs ?? NotificationPreferenceModel,
      notify,
      mail: mail ?? sendEmail,
      sms: sms ?? buildSmsSender(env.sms),
      appBaseUrl: appBaseUrl ?? env.appBaseUrl ?? 'https://c21fg.online',
      batch: Math.min(Math.max(Number(batch) || 5, 1), 25),
    });
  }

  async execute({ now = new Date() } = {}) {
    const t = now instanceof Date ? now : new Date(now);
    const result = { checked: 0, sent: 0, failed: [] };
    for (let i = 0; i < this.batch; i++) {
      const claimed = await this.broadcasts.findOneAndUpdate(
        { status: 'scheduled', sendAt: { $lte: t } },
        { $set: { status: 'sending' } },
        { new: true, sort: { sendAt: 1 } },
      ).lean().catch(() => null);
      if (!claimed) break;
      result.checked += 1;
      try {
        const stats = await this.fire(claimed);
        await this.broadcasts.updateOne(
          { _id: claimed._id },
          { $set: { status: 'sent', stats, recipientCount: stats.total } },
        ).catch(() => null);
        result.sent += 1;
      } catch (error) {
        await this.broadcasts.updateOne(
          { _id: claimed._id },
          { $set: { status: 'failed', error: String(error?.message ?? error).slice(0, 500) } },
        ).catch(() => null);
        result.failed.push({ id: String(claimed._id), error: error?.message ?? String(error) });
      }
    }
    return result;
  }

  async fire(row) {
    const input = {
      title: row.title,
      body: row.body,
      link: row.link,
      priority: row.priority,
      subject: row.subject ?? row.title,
      smsBody: row.smsBody ?? row.body,
      channels: row.channels ?? { inApp: true },
      kind: row.kind ?? 'system',
      audience: row.audience ?? { mode: 'all' },
    };
    const { members, capped } = await resolveAudience({ partners: this.partners }, input.audience);
    const map = await prefsMap(this.prefs, members.map((m) => m.id));
    const split = splitChannels(members, map, input.kind, input.channels);
    const broadcastId = String(row._id);
    const stats = {
      total: members.length,
      capped,
      inApp: { sent: 0, failed: 0 },
      email: { sent: 0, failed: 0 },
      sms: { sent: 0, failed: 0 },
      estimatedSmsSpend: input.channels.sms ? estimateSmsSpend(split.sms.length, input.smsBody) : 0,
    };
    if (input.channels.inApp && this.notify) {
      for (const m of split.inApp) {
        try {
          await this.notify.execute({
            recipientId: m.id,
            category: input.kind === 'marketing' ? 'marketing' : 'system',
            priority: input.priority,
            title: input.title,
            body: input.body,
            icon: 'campaign',
            link: input.link,
            key: `broadcast:${broadcastId}`,
          });
          stats.inApp.sent += 1;
        } catch { stats.inApp.failed += 1; }
      }
    }
    if (input.channels.email) {
      const html = plainEmailHtml(input.title, input.body, input.link, this.appBaseUrl);
      for (const m of split.email) {
        try {
          const receipt = await this.mail(m.email, input.subject, html);
          if (receipt && receipt.sent === false) stats.email.failed += 1;
          else stats.email.sent += 1;
        } catch { stats.email.failed += 1; }
      }
    }
    if (input.channels.sms) {
      for (const m of split.sms) {
        try {
          await this.sms.send({ to: m.phone, title: input.title, body: input.smsBody });
          stats.sms.sent += 1;
        } catch { stats.sms.failed += 1; }
      }
    }
    return stats;
  }
}

/** GET one campaign (admin) — full detail for the history drill-down. */
export class GetCampaignUseCase {
  /** @param {{broadcasts}} deps */
  constructor({ broadcasts } = {}) {
    this.broadcasts = broadcasts ?? BroadcastModel;
  }

  async execute({ id }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid broadcast id');
    const d = await this.broadcasts.findById(id).lean();
    if (!d) throw new NotFoundException('Broadcast not found');
    return {
      id: String(d._id),
      title: d.title,
      body: d.body,
      link: d.link ?? null,
      priority: d.priority ?? 'high',
      subject: d.subject ?? null,
      smsBody: d.smsBody ?? null,
      channels: d.channels ?? { inApp: true },
      kind: d.kind ?? 'system',
      audience: d.audience ?? null,
      sendAt: d.sendAt ?? null,
      status: d.status ?? 'sent',
      stats: d.stats ?? null,
      estimatedSmsSpend: d.estimatedSmsSpend ?? null,
      error: d.error ?? null,
      createdBy: d.createdBy ? String(d.createdBy) : null,
      recipientCount: d.recipientCount ?? 0,
      capped: !!d.capped,
      createdAt: d.createdAt ?? null,
    };
  }
}

/**
 * Cancel a scheduled campaign (scheduled → cancelled, atomic). Sent rows
 * are history — use delete for those. A cancelled row never fires: the
 * worker only claims `scheduled`.
 */
export class CancelCampaignUseCase {
  /** @param {{broadcasts}} deps */
  constructor({ broadcasts } = {}) {
    this.broadcasts = broadcasts ?? BroadcastModel;
  }

  async execute({ id }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid broadcast id');
    const doc = await this.broadcasts.findOneAndUpdate(
      { _id: id, status: 'scheduled' },
      { $set: { status: 'cancelled' } },
      { new: true },
    ).lean().catch(() => null);
    if (!doc) throw new ConflictException('Only scheduled campaigns can be cancelled');
    return { id: String(doc._id), status: doc.status };
  }
}

/**
 * Retry a failed campaign (failed → scheduled, fires within a minute).
 * History is preserved — the same row reruns, stats overwritten on success.
 */
export class RetryCampaignUseCase {
  /** @param {{broadcasts}} deps */
  constructor({ broadcasts } = {}) {
    this.broadcasts = broadcasts ?? BroadcastModel;
  }

  async execute({ id }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid broadcast id');
    const doc = await this.broadcasts.findOneAndUpdate(
      { _id: id, status: 'failed' },
      { $set: { status: 'scheduled', sendAt: new Date(), error: null } },
      { new: true },
    ).lean().catch(() => null);
    if (!doc) throw new ConflictException('Only failed campaigns can be retried');
    return { id: String(doc._id), status: doc.status, sendAt: doc.sendAt };
  }
}

/**
 * Hard delete a broadcast record + its fanned-out inbox rows
 * (key `broadcast:<id>`). Deleting history never unsends email/SMS —
 * the confirm copy says so plainly. Audited at the route.
 */
export class DeleteBroadcastUseCase {
  /** @param {{broadcasts, inbox}} deps */
  constructor({ broadcasts, inbox } = {}) {
    Object.assign(this, {
      broadcasts: broadcasts ?? BroadcastModel,
      inbox: inbox ?? StoredNotificationModel,
    });
  }

  async execute({ id }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid broadcast id');
    const doc = await this.broadcasts.findById(id).lean().catch(() => null);
    if (!doc) throw new NotFoundException('Broadcast not found');
    const swept = await this.inbox.deleteMany({ key: `broadcast:${String(doc._id)}` }).catch(() => ({ deletedCount: 0 }));
    await this.broadcasts.deleteOne({ _id: doc._id }).catch(() => null);
    return { id: String(doc._id), inboxRowsRemoved: swept?.deletedCount ?? 0 };
  }
}
