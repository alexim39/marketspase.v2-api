import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../../../shared/domain/AppError.js';
import { env } from '../../../shared/config/env.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import { ProspectModel } from '../../../apps/prospect/models/prospect.model.js';
import { TransactionModel } from '../../../apps/transaction/models/transaction.model.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { LogCommunicationUseCase } from '../../crm/application/Prospect.communications.js';
import { StoreCustomerLeadModel } from '../../stores/infrastructure/Store.models.js';
import { debitPartnerWallet } from '../../billing/application/Deposit.usecases.js';
import { buildSmsSender } from '../../notifications/infrastructure/SmsSender.js';
import {
  SmsCampaignModel,
  SmsRecipientModel,
  SmsSuppressionModel,
  SmsTemplateModel,
} from '../infrastructure/Sms.models.js';
import {
  SMS_MAX_RECIPIENTS,
  SMS_PRICE_PER_PAGE,
  cleanSmsBody,
  isPartnerSmsEnabled,
  normalizeRecipientPhone,
  recipientContext,
  renderedSms,
  smsPages,
  suggestionsForCustomerLead,
  suggestionsForPartner,
  suggestionsForProspect,
} from '../domain/Sms.domain.js';

const SMS_SYSTEM_TEMPLATES = [
  {
    id: 'follow-up',
    name: 'Friendly follow-up',
    body: 'Hi {{first_name}}, just following up on our conversation. I would be happy to answer any questions you have. - {{my_name}}',
  },
  {
    id: 'invitation',
    name: 'Invitation',
    body: 'Hi {{first_name}}, I have something I think could be useful for you. Would you be open to a quick look this week? - {{my_name}}',
  },
  {
    id: 'reminder',
    name: 'Reminder',
    body: 'Hi {{first_name}}, a quick reminder about our next step. Reply if you need anything from me. - {{my_name}}',
  },
  {
    id: 'activation',
    name: 'Activation reminder',
    body: 'Hi {{first_name}}, this is {{my_name}}. I noticed your activation is not complete yet. Reply if you want help with the next step.',
  },
  {
    id: 'welcome',
    name: 'Welcome',
    body: 'Hi {{first_name}}, welcome to the team. I am checking in to make sure you have everything you need for your first steps. - {{my_name}}',
  },
  {
    id: 'opportunity',
    name: 'Business opportunity',
    body: 'Hi {{first_name}}, I have a simple online business idea you can start from your phone. Would you like me to send the details? - {{my_name}}',
  },
];

const systemTemplates = () => SMS_SYSTEM_TEMPLATES.map((row) => ({ ...row, system: true }));

const validId = (id) => /^[a-fA-F0-9]{24}$/.test(String(id ?? ''));

const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const dayDiff = (value, now = Date.now()) => {
  const at = new Date(value ?? 0).getTime();
  if (!Number.isFinite(at) || at <= 0) return null;
  return Math.max(0, Math.floor((now - at) / 86400000));
};

const displayName = (row) => `${row?.name ?? row?.prospectName ?? ''} ${row?.surname ?? row?.prospectSurname ?? ''}`.trim();

const maskPhone = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length <= 4 ? digits : `•••• ${digits.slice(-4)}`;
};

const actorFor = (partner) => {
  const name = displayName(partner) || String(partner?.username ?? 'your MarketSpase partner');
  const username = String(partner?.username ?? '').trim();
  const base = String(env.appBaseUrl ?? 'https://marketspase.com').replace(/\/+$/, '');
  return {
    name,
    storeLink: username ? `${base}/${encodeURIComponent(username)}` : base,
    leadPage: username ? `${base}/lead/${encodeURIComponent(username)}` : base,
  };
};

const paginate = (limit, skip) => ({
  limit: Math.min(100, Math.max(1, Number(limit) || 20)),
  skip: Math.max(0, Number(skip) || 0),
});

const defaultEnqueue = (campaignId) => {
  import('./Sms.worker.js')
    .then(({ SmsCampaignProcessor }) => SmsCampaignProcessor.schedule(campaignId))
    .catch(() => null);
};

export class SmsService {
  constructor({
    sms = null,
    partners = PartnersModel,
    prospects = ProspectModel,
    customerLeads = StoreCustomerLeadModel,
    transactions = TransactionModel,
    campaigns = SmsCampaignModel,
    recipients = SmsRecipientModel,
    templates = SmsTemplateModel,
    suppressions = SmsSuppressionModel,
    logCommunication = null,
    enqueue = null,
  } = {}) {
    this.sms = sms ?? buildSmsSender(env.sms);
    this.partners = partners;
    this.prospects = prospects;
    this.customerLeads = customerLeads;
    this.transactions = transactions;
    this.campaignStore = campaigns;
    this.recipientStore = recipients;
    this.templateStore = templates;
    this.suppressionStore = suppressions;
    this.logCommunication = logCommunication
      ?? new LogCommunicationUseCase({ prospects: new MongoProspectRepository() });
    this.enqueue = enqueue ?? defaultEnqueue;
  }

  /** Queueing is best-effort; the due-scheduler and retry remain the backstop. */
  schedule(campaignId) {
    try {
      this.enqueue(String(campaignId));
    } catch { /* the campaign stays queued for the cron/retry path */ }
  }

  async wallet(partnerId) {
    const partner = await this.partners.findById(partnerId).select('balance name surname username').lean();
    if (!partner) throw new NotFoundException('Partner not found');
    return { balance: Number(partner.balance ?? 0), partner };
  }

  async suppressions(partnerId) {
    const rows = await this.suppressionStore.find({ partnerId }).sort({ createdAt: -1 }).lean();
    return rows.map((row) => ({
      id: String(row._id),
      phone: row.phone,
      maskedPhone: maskPhone(row.phone),
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  async addSuppression(partnerId, { phone, reason = 'Manual opt-out' }) {
    const normalised = normalizeRecipientPhone(phone);
    if (!normalised) throw new ValidationException('Enter a valid phone number');
    const row = await this.suppressionStore.findOneAndUpdate(
      { partnerId, phone: normalised },
      { $set: { reason: String(reason ?? 'Manual opt-out').slice(0, 200) } },
      { upsert: true, new: true },
    ).lean();
    return { id: String(row._id), phone: row.phone, reason: row.reason, createdAt: row.createdAt };
  }

  async removeSuppression(partnerId, id) {
    if (!validId(id)) throw new ValidationException('Invalid suppression id');
    const removed = await this.suppressionStore.findOneAndDelete({ _id: id, partnerId }).lean();
    if (!removed) throw new NotFoundException('Suppression not found');
    return { deleted: true };
  }

  async templates(partnerId) {
    const custom = await this.templateStore.find({ partnerId }).sort({ updatedAt: -1 }).lean();
    return [
      ...systemTemplates(),
      ...custom.map((row) => ({
        id: String(row._id),
        name: row.name,
        body: row.body,
        system: false,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    ];
  }

  async saveTemplate(partnerId, id, { name, body }) {
    const cleanedName = String(name ?? '').trim().slice(0, 80);
    const cleanedBody = cleanSmsBody(body);
    if (cleanedName.length < 2) throw new ValidationException('Template name is required');
    if (cleanedBody.length < 3) throw new ValidationException('Template message is required');
    if (id && !validId(id)) throw new ValidationException('Invalid template id');
    const payload = { partnerId, name: cleanedName, body: cleanedBody };
    const row = id
      ? await this.templateStore.findOneAndUpdate({ _id: id, partnerId }, { $set: payload }, { new: true }).lean()
      : await this.templateStore.create(payload).then((doc) => doc.toObject());
    if (!row) throw new NotFoundException('Template not found');
    return { id: String(row._id), name: row.name, body: row.body, system: false };
  }

  async deleteTemplate(partnerId, id) {
    if (!validId(id)) throw new ValidationException('Invalid template id');
    const removed = await this.templateStore.findOneAndDelete({ _id: id, partnerId }).lean();
    if (!removed) throw new NotFoundException('Template not found');
    return { deleted: true };
  }

  async recipients(partnerId, { type = 'prospects', q = '', limit = 50, skip = 0, id = '' } = {}) {
    const partner = await this.partners.findById(partnerId).lean();
    if (!partner) throw new NotFoundException('Partner not found');
    const wallet = Number(partner.balance ?? 0);
    const page = paginate(limit, skip);
    const suppressions = new Set((await this.suppressionStore.find({ partnerId }).select('phone').lean()).map((r) => r.phone));
    const query = String(q ?? '').trim();
    const selectedId = validId(id) ? String(id) : '';
    const rx = query ? new RegExp(escapeRegex(query), 'i') : null;
    const actor = actorFor(partner);
    const kind = type === 'partners' || type === 'customer_leads' ? type : 'prospects';
    const pageResult = (items, total) => ({
      type: kind,
      items,
      total,
      limit: page.limit,
      skip: page.skip,
      hasMore: page.skip + items.length < total,
      walletBalance: wallet,
      actor,
    });

    if (kind === 'partners') {
      const filter = { partnerOf: partnerId };
      if (selectedId) filter._id = selectedId;
      if (rx) filter.$or = [{ name: rx }, { surname: rx }, { username: rx }, { phone: rx }];
      const [rows, total] = await Promise.all([
        this.partners.find(filter)
          .select('name surname username phone accountState commissionRank activatedAt lastSeenAt createdAt settings mentorContactPreference')
          .sort({ updatedAt: -1 }).skip(page.skip).limit(page.limit).lean(),
        this.partners.countDocuments(filter),
      ]);
      const items = rows.map((row) => {
        const name = displayName(row) || row.username || 'Partner';
        const phone = normalizeRecipientPhone(row.phone);
        const smsEnabled = isPartnerSmsEnabled(row);
        const suppressed = phone && suppressions.has(phone);
        const eligible = Boolean(phone && smsEnabled && !suppressed);
        return {
          id: String(row._id),
          type: 'partner',
          name,
          username: row.username ?? '',
          phoneMasked: maskPhone(phone),
          eligible,
          reason: !phone ? 'No phone number' : suppressed ? 'Opted out of SMS' : !smsEnabled ? 'Asked not to be contacted' : null,
          context: {
            rank: row.commissionRank ?? 'Partner',
            state: row.accountState ?? 'member',
            activated: Boolean(row.activatedAt),
            lastSeenDays: dayDiff(row.lastSeenAt),
            joinedDays: dayDiff(row.createdAt),
          },
        };
      });
      return pageResult(items, total);
    }

    if (kind === 'customer_leads') {
      const filter = { partnerId };
      if (selectedId) filter._id = selectedId;
      if (rx) filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { city: rx }, { state: rx }];
      const [rows, total] = await Promise.all([
        this.customerLeads.find(filter).sort({ lastCheckoutAt: -1 }).skip(page.skip).limit(page.limit).lean(),
        this.customerLeads.countDocuments(filter),
      ]);
      const items = rows.map((row) => {
        const name = String(row.name ?? '').trim() || 'Customer';
        const phone = normalizeRecipientPhone(row.phone);
        const consented = row.consentToContact === true;
        const suppressed = phone && suppressions.has(phone);
        const eligible = Boolean(phone && consented && !suppressed);
        return {
          id: String(row._id),
          type: 'customer_lead',
          name,
          username: '',
          phoneMasked: maskPhone(phone),
          eligible,
          reason: !phone ? 'No phone number' : suppressed ? 'Opted out of SMS' : !consented ? 'No contact consent' : null,
          context: {
            status: row.status ?? 'New',
            paidOrders: Number(row.paidOrders ?? 0),
            totalSpent: Number(row.totalSpentKobo ?? 0) / 100,
            lastOrderDays: dayDiff(row.lastPaidAt),
            lastCheckoutDays: dayDiff(row.lastCheckoutAt),
          },
        };
      });
      return pageResult(items, total);
    }

    const filter = { partnerId };
    if (selectedId) filter._id = selectedId;
    if (rx) filter.$or = [{ prospectName: rx }, { prospectSurname: rx }, { prospectPhone: rx }, { prospectEmail: rx }];
    const [rows, total] = await Promise.all([
      this.prospects.find(filter)
        .select('prospectName prospectSurname prospectPhone status communications relationship priority consentToContact createdAt updatedAt')
        .sort({ updatedAt: -1 }).skip(page.skip).limit(page.limit).lean(),
      this.prospects.countDocuments(filter),
    ]);
    const items = rows.map((row) => {
      const name = displayName(row) || 'Prospect';
      const phone = normalizeRecipientPhone(row.prospectPhone);
      const consented = row.consentToContact === true;
      const suppressed = phone && suppressions.has(phone);
      const eligible = Boolean(phone && consented && !suppressed);
      const last = [...(row.communications ?? [])].sort((a, b) => new Date(b?.date ?? 0).getTime() - new Date(a?.date ?? 0).getTime())[0] ?? null;
      return {
        id: String(row._id),
        type: 'prospect',
        name,
        username: '',
        phoneMasked: maskPhone(phone),
        eligible,
        reason: !phone ? 'No phone number' : suppressed ? 'Opted out of SMS' : !consented ? 'No contact consent' : null,
        context: {
          stage: row.status?.stage ?? 'New',
          priority: row.priority ?? 'normal',
          relationship: row.relationship ?? 'Prospect',
          lastTouchAt: last?.date ?? null,
          followUpDate: last?.followUpDate ?? null,
          daysInStage: dayDiff(row.status?.stageEnteredAt ?? row.updatedAt ?? row.createdAt),
        },
      };
    });
    return pageResult(items, total);
  }

  async suggest(partnerId, { type, id }) {
    const partner = await this.partners.findById(partnerId).lean();
    if (!partner) throw new NotFoundException('Partner not found');
    const actor = actorFor(partner);
    if (type === 'partner') {
      if (!validId(id)) throw new ValidationException('Invalid partner');
      const row = await this.partners.findOne({ _id: id, partnerOf: partnerId }).lean();
      if (!row) throw new NotFoundException('Partner not found');
      return { recipient: { id, type, name: displayName(row) || row.username }, suggestions: suggestionsForPartner(row, actor) };
    }
    if (type === 'customer_lead') {
      if (!validId(id)) throw new ValidationException('Invalid customer');
      const row = await this.customerLeads.findOne({ _id: id, partnerId }).lean();
      if (!row) throw new NotFoundException('Customer lead not found');
      return {
        recipient: { id, type: 'customer_lead', name: String(row.name ?? '').trim() || 'Customer' },
        suggestions: suggestionsForCustomerLead(row, actor),
      };
    }
    if (!validId(id)) throw new ValidationException('Invalid prospect');
    const row = await this.prospects.findOne({ _id: id, partnerId }).lean();
    if (!row) throw new NotFoundException('Prospect not found');
    return { recipient: { id, type: 'prospect', name: displayName(row) }, suggestions: suggestionsForProspect(row, actor) };
  }

  async resolveRecipients(partnerId, recipients = []) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new ValidationException('Select at least one recipient');
    }
    const unique = new Map();
    for (const row of recipients) {
      const type = row?.type === 'partner' ? 'partner' : row?.type === 'customer_lead' ? 'customer_lead' : 'prospect';
      const id = String(row?.id ?? '');
      if (!validId(id)) continue;
      unique.set(`${type}:${id}`, { type, id });
    }
    if (unique.size === 0) throw new ValidationException('Select at least one recipient');
    if (unique.size > SMS_MAX_RECIPIENTS) {
      throw new ValidationException(`At most ${SMS_MAX_RECIPIENTS} recipients can be selected at once`);
    }
    const partner = await this.partners.findById(partnerId).lean();
    if (!partner) throw new NotFoundException('Partner not found');
    const suppressions = new Set((await this.suppressionStore.find({ partnerId }).select('phone').lean()).map((r) => r.phone));
    const actor = actorFor(partner);
    const resolved = [];
    const ineligible = [];
    const prospectIds = [];
    const partnerIds = [];
    const customerLeadIds = [];
    for (const entry of unique.values()) {
      if (entry.type === 'prospect') prospectIds.push(entry.id);
      else if (entry.type === 'partner') partnerIds.push(entry.id);
      else customerLeadIds.push(entry.id);
    }
    const [prospectRows, partnerRows, customerLeadRows] = await Promise.all([
      prospectIds.length
        ? this.prospects.find({ _id: { $in: prospectIds }, partnerId }).lean()
        : Promise.resolve([]),
      partnerIds.length
        ? this.partners.find({ _id: { $in: partnerIds }, partnerOf: partnerId })
          .select('name surname username phone accountState commissionRank activatedAt lastSeenAt createdAt settings mentorContactPreference')
          .lean()
        : Promise.resolve([]),
      customerLeadIds.length
        ? this.customerLeads.find({ _id: { $in: customerLeadIds }, partnerId }).lean()
        : Promise.resolve([]),
    ]);
    const prospectsById = new Map(prospectRows.map((row) => [String(row._id), row]));
    const partnersById = new Map(partnerRows.map((row) => [String(row._id), row]));
    const customerLeadsById = new Map(customerLeadRows.map((row) => [String(row._id), row]));

    for (const entry of unique.values()) {
      if (entry.type === 'prospect') {
        const row = prospectsById.get(entry.id);
        if (!row) { ineligible.push({ ...entry, name: 'Unknown prospect', reason: 'Not in your pipeline' }); continue; }
        const name = displayName(row) || 'Prospect';
        const phone = normalizeRecipientPhone(row.prospectPhone);
        let reason = null;
        if (!phone) reason = 'No phone number';
        else if (row.consentToContact !== true) reason = 'No contact consent';
        else if (suppressions.has(phone)) reason = 'Opted out of SMS';
        if (reason) ineligible.push({ ...entry, name, reason });
        else resolved.push({ ...entry, doc: row, name, phone, context: recipientContext('prospect', row, actor) });
      } else if (entry.type === 'customer_lead') {
        const row = customerLeadsById.get(entry.id);
        if (!row) { ineligible.push({ ...entry, name: 'Unknown customer', reason: 'Not in your customer leads' }); continue; }
        const name = String(row.name ?? '').trim() || 'Customer';
        const phone = normalizeRecipientPhone(row.phone);
        let reason = null;
        if (!phone) reason = 'No phone number';
        else if (row.consentToContact !== true) reason = 'No contact consent';
        else if (suppressions.has(phone)) reason = 'Opted out of SMS';
        if (reason) ineligible.push({ ...entry, name, reason });
        else resolved.push({ ...entry, doc: row, name, phone, context: recipientContext('customer_lead', row, actor) });
      } else {
        const row = partnersById.get(entry.id);
        if (!row) { ineligible.push({ ...entry, name: 'Unknown partner', reason: 'Not in your direct team' }); continue; }
        const name = displayName(row) || row.username || 'Partner';
        const phone = normalizeRecipientPhone(row.phone);
        let reason = null;
        if (!phone) reason = 'No phone number';
        else if (!isPartnerSmsEnabled(row)) reason = 'Asked not to be contacted';
        else if (suppressions.has(phone)) reason = 'Opted out of SMS';
        if (reason) ineligible.push({ ...entry, name, reason });
        else resolved.push({ ...entry, doc: row, name, phone, context: recipientContext('partner', row, actor) });
      }
    }
    return { partner, actor, resolved, ineligible, walletBalance: Number(partner.balance ?? 0) };
  }

  async quote(partnerId, { recipients, body }) {
    const text = cleanSmsBody(body);
    if (text.length < 3) throw new ValidationException('Message is required');
    const { resolved, ineligible, walletBalance } = await this.resolveRecipients(partnerId, recipients);
    const priced = resolved.map((row) => {
      const renderedBody = renderedSms(text, row.context);
      const pages = smsPages(renderedBody);
      return { ...row, renderedBody, pages, cost: pages * SMS_PRICE_PER_PAGE };
    });
    const pages = priced.reduce((max, row) => Math.max(max, row.pages), 0);
    const cost = priced.reduce((sum, row) => sum + row.cost, 0);
    return {
      pages,
      recipients: priced.length,
      ineligible,
      cost,
      pricePerPage: SMS_PRICE_PER_PAGE,
      walletBalance,
      canSend: priced.length > 0 && cost <= walletBalance,
      shortfall: Math.max(0, cost - walletBalance),
      normalisedBody: text,
      previews: priced.slice(0, 3).map((row) => ({
        name: row.name,
        phoneMasked: maskPhone(row.phone),
        pages: row.pages,
        cost: row.cost,
        body: row.renderedBody,
      })),
    };
  }

  async send(partnerId, { idempotencyKey, recipients, body, scheduledAt = null }) {
    const key = String(idempotencyKey ?? '').trim();
    if (!key) throw new ValidationException('Missing send reference');
    const existing = await this.campaignStore.findOne({ partnerId, idempotencyKey: key }).lean();
    if (existing) return this.campaignResponse(existing);

    const text = cleanSmsBody(body);
    if (text.length < 3) throw new ValidationException('Message is required');
    const { resolved, ineligible, walletBalance } = await this.resolveRecipients(partnerId, recipients);
    if (resolved.length === 0) throw new ValidationException('No eligible recipients selected');
    const priced = resolved.map((row) => {
      const renderedBody = renderedSms(text, row.context);
      const pages = smsPages(renderedBody);
      return { ...row, renderedBody, pages, cost: pages * SMS_PRICE_PER_PAGE };
    });
    const pages = priced.reduce((max, row) => Math.max(max, row.pages), 0);
    const totalCost = priced.reduce((sum, row) => sum + row.cost, 0);
    if (totalCost > walletBalance) {
      throw new ConflictException(`Insufficient wallet balance. You need ₦${totalCost.toLocaleString()} but have ₦${walletBalance.toLocaleString()}.`);
    }

    const sendAt = scheduledAt ? new Date(scheduledAt) : null;
    if (sendAt && Number.isNaN(sendAt.getTime())) throw new ValidationException('Invalid schedule date');
    const status = sendAt && sendAt.getTime() > Date.now() ? 'scheduled' : 'sending';

    let campaign;
    try {
      campaign = await this.campaignStore.create({
        partnerId,
        idempotencyKey: key,
        body: text,
        pages,
        pricePerPage: SMS_PRICE_PER_PAGE,
        totalCost,
        recipientCount: priced.length,
        status,
        scheduledAt: status === 'scheduled' ? sendAt : null,
        createdBy: partnerId,
      });
    } catch (error) {
      // A double-submit can race past the idempotency lookup; the unique
      // index wins and the loser returns the campaign the winner created.
      if (error?.code === 11000) {
        const winner = await this.campaignStore.findOne({ partnerId, idempotencyKey: key }).lean();
        if (winner) return this.campaignResponse(winner);
      }
      throw error;
    }

    let debit = null;
    try {
      debit = await debitPartnerWallet(
        { partners: this.partners },
        { partnerId, amountNgn: totalCost },
      );
      if (!debit) throw new ConflictException('Your wallet balance changed. Refresh and try again.');

      let remainingBonus = debit.bonusUsed;
      const rows = priced.map((row) => {
        const bonusCost = Math.min(remainingBonus, row.cost);
        remainingBonus = Math.round((remainingBonus - bonusCost) * 100) / 100;
        return { ...row, bonusCost };
      });
      await this.recipientStore.insertMany(rows.map((row) => ({
        campaignId: campaign._id,
        partnerId,
        recipientType: row.type,
        recipientId: row.id,
        name: row.name,
        phone: row.phone,
        renderedBody: row.renderedBody,
        pages: row.pages,
        cost: row.cost,
        bonusCost: row.bonusCost,
        status: 'queued',
      })));

      await this.transactions.create({
        partnerId,
        amount: -totalCost,
        bonusAmount: debit.bonusUsed,
        balanceBefore: Number(debit.partner.balance ?? 0) + totalCost,
        balanceAfter: Number(debit.partner.balance ?? 0),
        reference: `sms:${String(campaign._id)}`,
        status: 'Completed',
        paymentMethod: 'Wallet',
        transactionType: 'SMS',
        date: new Date(),
      });

      if (status === 'sending') this.schedule(String(campaign._id));

      const saved = typeof campaign.toObject === 'function' ? campaign.toObject() : campaign;
      return this.campaignResponse(saved, ineligible);
    } catch (error) {
      // Never leave a debit without a campaign (or a campaign without a
      // debit). Both halves of the write must stand or fall together.
      if (debit) {
        await this.partners.findOneAndUpdate(
          { _id: partnerId },
          { $inc: { balance: totalCost, bonusBalance: debit.bonusUsed } },
          { new: true },
        ).catch(() => null);
      }
      await this.recipientStore.deleteMany({ campaignId: campaign._id }).catch(() => null);
      await this.campaignStore.deleteOne({ _id: campaign._id }).catch(() => null);
      throw error;
    }
  }

  async history(partnerId, { limit = 20, skip = 0, status = '' } = {}) {
    const page = paginate(limit, skip);
    const query = { partnerId };
    if (status) query.status = status;
    const [rows, total] = await Promise.all([
      this.campaignStore.find(query).sort({ createdAt: -1 }).skip(page.skip).limit(page.limit).lean(),
      this.campaignStore.countDocuments(query),
    ]);
    return {
      items: rows.map((row) => this.campaignResponse(row)),
      total,
      limit: page.limit,
      skip: page.skip,
    };
  }

  async detail(partnerId, id) {
    if (!validId(id)) throw new ValidationException('Invalid campaign id');
    const campaign = await this.campaignStore.findOne({ _id: id, partnerId }).lean();
    if (!campaign) throw new NotFoundException('SMS campaign not found');
    const recipients = await this.recipientStore.find({ campaignId: id }).sort({ createdAt: 1 }).lean();
    return {
      ...this.campaignResponse(campaign),
      recipients: recipients.map((row) => ({
        id: String(row._id),
        type: row.recipientType,
        recipientId: row.recipientId,
        name: row.name,
        phoneMasked: maskPhone(row.phone),
        status: row.status,
        cost: row.cost,
        bonusCost: row.bonusCost ?? 0,
        refundedAmount: row.refundAmount ?? 0,
        error: row.error,
        sentAt: row.sentAt,
      })),
    };
  }

  async cancel(partnerId, id) {
    if (!validId(id)) throw new ValidationException('Invalid campaign id');
    const campaign = await this.campaignStore.findOne({ _id: id, partnerId }).lean();
    if (!campaign) throw new NotFoundException('SMS campaign not found');
    if (campaign.status !== 'scheduled') throw new ValidationException('Only scheduled SMS campaigns can be cancelled');
    const rows = await this.recipientStore.find({ campaignId: id }).lean();
    let refunded = 0;
    for (const row of rows) {
      refunded += await this.refundRecipient(row);
    }
    await this.recipientStore.updateMany(
      { campaignId: id },
      { $set: { status: 'cancelled', error: null } },
    );
    const updated = await this.campaignStore.findOneAndUpdate(
      { _id: id, partnerId, status: 'scheduled' },
      { $set: { status: 'cancelled', completedAt: new Date(), refundedAmount: refunded } },
      { new: true },
    ).lean();
    if (!updated) throw new ConflictException('This SMS is no longer scheduled and cannot be cancelled');
    return this.campaignResponse(updated);
  }

  async retry(partnerId, id) {
    if (!validId(id)) throw new ValidationException('Invalid campaign id');
    const campaign = await this.campaignStore.findOne({ _id: id, partnerId }).lean();
    if (!campaign) throw new NotFoundException('SMS campaign not found');
    if (!['failed', 'partial'].includes(campaign.status)) throw new ValidationException('Only failed messages can be retried');
    const failed = await this.recipientStore.find({ campaignId: id, status: 'failed' }).lean();
    if (failed.length === 0) throw new ValidationException('No failed recipients to retry');
    const totalCost = failed.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
    const debit = await debitPartnerWallet(
      { partners: this.partners },
      { partnerId, amountNgn: totalCost },
    );
    if (!debit) throw new ConflictException(`Insufficient wallet balance for retry. You need ₦${totalCost.toLocaleString()}.`);
    try {
      await this.transactions.create({
        partnerId,
        amount: -totalCost,
        bonusAmount: debit.bonusUsed,
        balanceBefore: Number(debit.partner.balance ?? 0) + totalCost,
        balanceAfter: Number(debit.partner.balance ?? 0),
        reference: `smsretry:${id}:${Date.now()}`,
        status: 'Completed',
        paymentMethod: 'Wallet',
        transactionType: 'SMS',
        date: new Date(),
      });
      let remainingBonus = debit.bonusUsed;
      for (const row of failed) {
        const bonusCost = Math.min(remainingBonus, Number(row.cost ?? 0));
        remainingBonus = Math.round((remainingBonus - bonusCost) * 100) / 100;
        await this.recipientStore.updateOne({ _id: row._id }, {
          $set: {
            status: 'queued',
            error: null,
            refundedAt: null,
            refundAmount: 0,
            providerId: null,
            sentAt: null,
            bonusCost,
          },
        });
      }
      const updated = await this.campaignStore.findByIdAndUpdate(id, {
        $set: {
          status: 'sending',
          completedAt: null,
          error: null,
          refundedAmount: Math.max(0, Number(campaign.refundedAmount ?? 0) - totalCost),
        },
      }, { new: true }).lean();
      this.schedule(String(id));
      return this.campaignResponse(updated);
    } catch (error) {
      await this.partners.findOneAndUpdate(
        { _id: partnerId },
        { $inc: { balance: totalCost, bonusBalance: debit.bonusUsed } },
        { new: true },
      ).catch(() => null);
      throw error;
    }
  }

  async refundRecipient(recipient) {
    const claimed = await this.recipientStore.findOneAndUpdate(
      { _id: recipient._id, refundedAt: null },
      { $set: { refundedAt: new Date(), refundAmount: Number(recipient.cost ?? 0) } },
      { new: true },
    ).lean();
    if (!claimed || !(Number(recipient.cost) > 0)) return 0;
    const amount = Number(recipient.cost);
    const bonusCost = Math.min(amount, Math.max(0, Number(recipient.bonusCost ?? 0)));
    const updated = await this.partners.findOneAndUpdate(
      { _id: recipient.partnerId },
      { $inc: { balance: amount, bonusBalance: bonusCost } },
      { new: true },
    ).lean();
    await this.transactions.create({
      partnerId: recipient.partnerId,
      amount,
      bonusAmount: bonusCost,
      balanceBefore: Number(updated?.balance ?? 0) - amount,
      balanceAfter: Number(updated?.balance ?? 0),
      reference: `smsrefund:${String(recipient._id)}`,
      status: 'Completed',
      paymentMethod: 'Wallet',
      transactionType: 'SMS refund',
      date: new Date(),
    }).catch(() => null);
    return amount;
  }

  async logProspectSms(recipient, body) {
    try {
      await this.logCommunication.execute({
        prospectId: recipient.recipientId,
        type: 'text',
        interestLevel: 'warm',
        description: `SMS Center: ${body}`.slice(0, 5000),
        followUpAction: 'Await reply',
        createdBy: String(recipient.partnerId),
        createdByName: 'SMS Center',
      });
    } catch { /* logging must never fail delivery status */ }
  }

  async logCustomerLeadSms(recipient) {
    try {
      await this.customerLeads.updateOne(
        { _id: recipient.recipientId, partnerId: recipient.partnerId },
        {
          $set: { lastOutreachAt: new Date(), lastOutreachChannel: 'sms' },
          $inc: { outreachCount: 1 },
        },
      );
    } catch { /* logging must never fail delivery status */ }
  }

  async processCampaign(id) {
    if (!validId(id)) return null;
    const campaign = await this.campaignStore.findOneAndUpdate(
      { _id: id, status: { $in: ['sending', 'scheduled'] } },
      { $set: { status: 'sending', startedAt: new Date(), error: null } },
      { new: true },
    ).lean();
    if (!campaign) return null;
    const queued = await this.recipientStore.find({ campaignId: id, status: 'queued' }).lean();
    for (let i = 0; i < queued.length; i += 5) {
      const batch = queued.slice(i, i + 5);
      await Promise.all(batch.map(async (recipient) => {
        try {
          const receipt = await this.sms.send({
            to: recipient.phone,
            title: '',
            body: recipient.renderedBody,
          });
          if (receipt?.logged) throw new Error('SMS is not configured on this server');
          await this.recipientStore.updateOne(
            { _id: recipient._id },
            { $set: { status: 'sent', providerId: receipt?.providerId ?? null, sentAt: new Date(), error: null } },
          );
          if (recipient.recipientType === 'prospect') {
            await this.logProspectSms(recipient, recipient.renderedBody);
          } else if (recipient.recipientType === 'customer_lead') {
            await this.logCustomerLeadSms(recipient);
          }
        } catch (error) {
          const message = String(error?.message ?? error).slice(0, 500);
          await this.recipientStore.updateOne(
            { _id: recipient._id },
            { $set: { status: 'failed', error: message } },
          );
          await this.refundRecipient({ ...recipient, cost: recipient.cost, partnerId: recipient.partnerId });
        }
      }));
    }
    const [sentCount, failedCount, refunds] = await Promise.all([
      this.recipientStore.countDocuments({ campaignId: id, status: 'sent' }),
      this.recipientStore.countDocuments({ campaignId: id, status: 'failed' }),
      this.recipientStore.aggregate([
        { $match: { campaignId: campaign._id } },
        { $group: { _id: null, amount: { $sum: '$refundAmount' } } },
      ]),
    ]);
    const total = sentCount + failedCount;
    const status = total === 0 ? 'failed' : failedCount === 0 ? 'sent' : sentCount === 0 ? 'failed' : 'partial';
    return this.campaignStore.findByIdAndUpdate(id, {
      $set: {
        status,
        sentCount,
        failedCount,
        refundedAmount: Number(refunds?.[0]?.amount ?? 0),
        completedAt: new Date(),
        error: failedCount > 0 ? `${failedCount} message${failedCount === 1 ? '' : 's'} failed and were refunded` : null,
      },
    }, { new: true }).lean();
  }

  async processDueScheduled(limit = 10) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const [due, stale] = await Promise.all([
      this.campaignStore.find({
        status: 'scheduled',
        scheduledAt: { $lte: now },
      }).sort({ scheduledAt: 1 }).limit(limit).lean(),
      // A process restart between the debit and the worker leaves a campaign
      // in `sending`. Recover only clearly abandoned rows so an active worker
      // is never raced into sending a recipient twice.
      this.campaignStore.find({
        status: 'sending',
        startedAt: { $lte: staleBefore },
      }).sort({ startedAt: 1 }).limit(limit).lean(),
    ]);
    const campaigns = [...due, ...stale];
    for (const campaign of campaigns) {
      await this.processCampaign(String(campaign._id));
    }
    return { checked: campaigns.length, scheduled: due.length, recovered: stale.length };
  }

  campaignResponse(row, ineligible = []) {
    return {
      id: String(row._id ?? row.id),
      body: row.body,
      pages: row.pages,
      pricePerPage: row.pricePerPage,
      totalCost: row.totalCost,
      recipientCount: row.recipientCount,
      sentCount: row.sentCount ?? 0,
      failedCount: row.failedCount ?? 0,
      refundedAmount: row.refundedAmount ?? 0,
      status: row.status,
      scheduledAt: row.scheduledAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      error: row.error ?? null,
      ineligible,
    };
  }
}

export const smsService = new SmsService();
export { SMS_SYSTEM_TEMPLATES, maskPhone, systemTemplates };
