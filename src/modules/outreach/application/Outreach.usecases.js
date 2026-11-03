import { AppError, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { createBulkEmailEntity, createBulkSmsEntity } from '../domain/Outreach.entity.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { ParterSMSModel } from '../../../apps/sms/models/sms.model.js';
import { ParterEmailsModel } from '../../../apps/email/models/email.model.js';
import { ScheduledSmsModel } from '../infrastructure/ScheduledSms.model.js';
import { sendEmail } from '../../../services/emailService.js';
import { paragraphs } from '../../../services/emailBrand.js';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * Shared charge + send + record core (used by immediate sends and the
 * scheduled worker). Charge happens at send time, so cancelled or
 * never-due items never touch the wallet.
 */
export const deliverBulkSms = async ({ partners, transactions, records, sms }, { partnerId, to, body, campaignId = null, reference = null }) => {
  const entity = createBulkSmsEntity({ to, body });
  const exists = await partners.findById(partnerId).select('_id').lean().catch(() => null);
  if (!exists) throw new NotFoundException('Partner not found');
  // Atomic conditional debit — never load-modify-save the partner doc:
  // full-document saves re-validate legacy fields (one bad legacy value
  // once broke every SMS send), and concurrent sends could double-spend
  // a stale balance read. Null = insufficient funds, not missing partner.
  const charged = await partners.findOneAndUpdate(
    { _id: partnerId, balance: { $gte: entity.cost } },
    { $inc: { balance: -entity.cost } },
    { new: true },
  ).lean().catch(() => null);
  if (!charged) {
    throw new AppError('Insufficient balance for transaction', 401, 'INSUFFICIENT_BALANCE');
  }
  const transaction = await transactions.create({
    partnerId,
    amount: entity.cost,
    status: 'Completed',
    paymentMethod: 'SMS Charge',
    transactionType: 'Debit',
    reference: reference ?? Math.floor(100000000 + Math.random() * 900000000).toString(),
  });

  const failed = [];
  let sent = 0;
  let index = 0;
  for (const recipient of entity.to) {
    const ref = `${transaction._id}:${index}`;
    index += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      await sms.send({ to: recipient, title: '', body: entity.body, extra: { customer_reference: ref } });
      sent += 1;
    } catch (error) {
      failed.push({ to: recipient, error: error?.message ?? 'Send failed' });
    }
  }
  const status = failed.length === 0 ? 'success' : sent === 0 ? 'failed' : 'partial';
  await records.create({
    smsBody: entity.body,
    partnerId,
    prospect: entity.to,
    transactionId: transaction._id,
    status,
    cost: entity.cost,
    ...(campaignId ? { campaignId } : {}),
  });
  return {
    sent,
    failed,
    total: entity.to.length,
    pages: entity.pages,
    cost: entity.cost,
    transactionId: String(transaction._id),
    status,
  };
};

/**
 * POST /v1/outreach/sms — one call replaces the legacy three-step
 * (charge → browser-direct gateway → save). Same economics as billing
 * bulkSMSCharge (per-page rate, wallet debit, Completed/Debit record);
 * the gateway secret never leaves the server. Charge happens only when
 * a real sender is configured — a disabled provider answers 503 before
 * any money moves. Per-recipient failures are collected, never fatal.
 */
export class SendBulkSmsUseCase {
  /** @param {{partners, transactions, records, sms, smsEnabled, campaigns?}} deps */
  constructor({ partners, transactions, records, sms, smsEnabled = true, campaigns = null } = {}) {
    Object.assign(this, {
      partners: partners ?? PartnersModel,
      transactions: transactions ?? TransactionModel,
      records: records ?? ParterSMSModel,
      sms,
      smsEnabled,
      campaigns,
    });
  }

  async execute({ partnerId, to, body, campaignId = null }) {
    if (!this.smsEnabled || !this.sms) {
      throw new AppError('SMS sending is not configured yet', 503, 'SMS_NOT_CONFIGURED');
    }
    let campaign = null;
    if (campaignId !== undefined && campaignId !== null && String(campaignId).trim() !== '') {
      const id = String(campaignId).trim();
      if (!OBJECT_ID_RE.test(id)) throw new ValidationException('Invalid campaign');
      campaign = this.campaigns
        ? await this.campaigns.findOwned(id, String(partnerId)).catch(() => null)
        : null;
      if (!campaign) throw new NotFoundException('Campaign not found');
    }
    return deliverBulkSms(
      { partners: this.partners, transactions: this.transactions, records: this.records, sms: this.sms },
      { partnerId, to, body, campaignId: campaign ? String(campaign._id ?? campaign.id ?? campaignId) : null },
    );
  }
}

/**
 * Shared bulk-email core (used by the scheduled worker). Free channel —
 * no wallet movement; per-recipient failures collected like SMS.
 */
export const deliverBulkEmail = async ({ partners, records, mail }, { partnerId, to, subject, body }) => {
  const entity = createBulkEmailEntity({ to, subject, body });
  const partner = await partners.findById(partnerId);
  if (!partner) throw new NotFoundException('Partner not found');
  const failed = [];
  let sent = 0;
  for (const recipient of entity.to) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const receipt = await mail(recipient, entity.subject, paragraphs(entity.body));
      // sendEmail resolves {sent:false} instead of throwing — an explicit
      // false is a failed recipient, not a sent one (else partial-failure
      // reporting and the email log would lie).
      if (receipt && receipt.sent === false) {
        throw new Error(receipt.error ?? 'Send failed');
      }
      sent += 1;
    } catch (error) {
      failed.push({ to: recipient, error: error?.message ?? 'Send failed' });
    }
  }
  const status = failed.length === 0 ? 'success' : sent === 0 ? 'failed' : 'partial';
  await records.create({
    emailSubject: entity.subject,
    emailBody: entity.body,
    partnerId: partner._id,
    prospects: entity.to,
  });
  return { sent, failed, total: entity.to.length, status };
};

/**
 * POST /v1/outreach/email — immediate bulk email through the same core the
 * scheduled worker fires (validated, capped, recorded, per-recipient
 * outcomes). Session-owned: no body partnerId to tamper with. Replaces the
 * legacy `emails/send-email` (no auth, no caps, receipt ignored).
 */
export class SendBulkEmailUseCase {
  /** @param {{partners, records, mail}} deps */
  constructor({ partners, records, mail } = {}) {
    Object.assign(this, {
      partners: partners ?? PartnersModel,
      records: records ?? ParterEmailsModel,
      mail: mail ?? sendEmail,
    });
  }

  async execute({ partnerId, to, subject, body }) {
    return deliverBulkEmail(
      { partners: this.partners, records: this.records, mail: this.mail },
      { partnerId, to, subject, body },
    );
  }
}

/** Outbox write — validated now, charged at fire time by the worker. */
export class ScheduleBulkSmsUseCase {  /** @param {{schedules, campaigns?}} deps */
  constructor({ schedules, campaigns = null } = {}) {
    Object.assign(this, {
      schedules: schedules ?? ScheduledSmsModel,
      campaigns,
    });
  }

  async execute({ partnerId, to, body, sendAt, campaignId = null, channel = 'sms', subject = '' }) {
    if (channel !== 'sms' && channel !== 'email') throw new ValidationException('Invalid channel');
    const entity = channel === 'email'
      ? createBulkEmailEntity({ to, subject, body })
      : createBulkSmsEntity({ to, body });
    const at = sendAt instanceof Date ? sendAt : new Date(sendAt);
    if (Number.isNaN(at.getTime())) throw new ValidationException('Invalid scheduled time');
    if (at.getTime() <= Date.now()) throw new ValidationException('Scheduled time must be in the future');
    if (at.getTime() - Date.now() > 30 * 86400000) {
      throw new ValidationException('Scheduled time must be within 30 days');
    }
    let campaign = null;
    if (channel === 'sms' && campaignId !== undefined && campaignId !== null && String(campaignId).trim() !== '') {
      const id = String(campaignId).trim();
      if (!OBJECT_ID_RE.test(id)) throw new ValidationException('Invalid campaign');
      campaign = this.campaigns
        ? await this.campaigns.findOwned(id, String(partnerId)).catch(() => null)
        : null;
      if (!campaign) throw new NotFoundException('Campaign not found');
    }
    const doc = await this.schedules.create({
      partnerId,
      channel,
      to: entity.to,
      smsBody: entity.body,
      emailSubject: channel === 'email' ? entity.subject : '',
      campaignId: campaign ? (campaign._id ?? campaign.id ?? null) : null,
      sendAt: at,
      status: 'scheduled',
    });
    return {
      id: String(doc._id),
      channel,
      to: entity.to,
      pages: channel === 'sms' ? entity.pages : null,
      cost: channel === 'sms' ? entity.cost : 0,
      sendAt: doc.sendAt,
    };
  }
}

/** Partner's scheduled outbox (upcoming + recent), newest first. */
export class ListScheduledSmsUseCase {
  /** @param {{schedules}} deps */
  constructor({ schedules } = {}) {
    this.schedules = schedules ?? ScheduledSmsModel;
  }

  async execute({ partnerId, limit = 50, channel = null }) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const filter = { partnerId };
    if (channel === 'sms' || channel === 'email') filter.channel = channel;
    const docs = await this.schedules
      .find(filter)
      .sort({ sendAt: -1 })
      .limit(lim)
      .lean();
    return docs.map((d) => ({
      id: String(d._id),
      channel: d.channel ?? 'sms',
      to: d.to ?? [],
      total: (d.to ?? []).length,
      smsBody: d.smsBody ?? '',
      emailSubject: d.emailSubject ?? '',
      campaignId: d.campaignId ? String(d.campaignId) : null,
      sendAt: d.sendAt,
      status: d.status,
      attempts: d.attempts ?? 0,
      result: d.result ?? null,
      createdAt: d.createdAt,
    }));
  }
}

/** Cancel own scheduled send (sent/failed rows are history, not cancellable). */
export class CancelScheduledSmsUseCase {
  /** @param {{schedules}} deps */
  constructor({ schedules } = {}) {
    this.schedules = schedules ?? ScheduledSmsModel;
  }

  async execute({ partnerId, scheduleId }) {
    const doc = await this.schedules.findOneAndUpdate(
      { _id: scheduleId, partnerId, status: 'scheduled' },
      { $set: { status: 'cancelled' } },
      { new: true },
    ).lean();
    if (!doc) throw new NotFoundException('Scheduled send not found');
    return { cancelled: true };
  }
}

/**
 * Session-owned inbox reads — the owner comes from the session, never a
 * URL param, so a stale/wrong client id can never render another (or an
 * empty) inbox. Same row shapes as the legacy param-id endpoints.
 */
const newestFirst = async (store, partnerId, limit = 200) => {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return store.find({ partnerId }).sort({ createdAt: -1 }).limit(lim).lean();
};

/** GET /v1/outreach/sms/mine — own SMS batches, newest first. */
export class ListMySmsUseCase {
  /** @param {{records, transactions}} deps */
  constructor({ records, transactions } = {}) {
    Object.assign(this, {
      records: records ?? ParterSMSModel,
      transactions: transactions ?? TransactionModel,
    });
  }

  async execute({ partnerId, limit } = {}) {
    const rows = await newestFirst(this.records, partnerId, limit);
    // Attach each batch's charge record (same shape as the legacy inbox
    // read — the history table renders transaction reference + amount).
    const txs = await this.transactions.find({ partnerId }).lean().catch(() => []);
    const byId = new Map((txs ?? []).map((t) => [String(t._id), t]));
    return rows.map((r) => ({
      ...r,
      transaction: byId.get(String(r.transactionId)) ?? null,
    }));
  }
}

/** GET /v1/outreach/email/mine — own email batches, newest first. */
export class ListMyEmailsUseCase {
  /** @param {{emailRecords}} deps */
  constructor({ emailRecords } = {}) {
    this.emailRecords = emailRecords ?? ParterEmailsModel;
  }

  async execute({ partnerId, limit } = {}) {
    return newestFirst(this.emailRecords, partnerId, limit);
  }
}
