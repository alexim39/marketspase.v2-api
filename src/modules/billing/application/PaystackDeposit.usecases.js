import { AppError, ConflictException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { assertDepositAmount, newDepositReference, toKobo } from '../domain/Deposit.js';
import { DepositIntentModel } from '../infrastructure/Deposit.mongo.model.js';
import { PartnersModel, TransactionModel, runInTransaction } from '../infrastructure/Billing.models.js';
import { creditPartnerWallet } from './Deposit.usecases.js';
import { verifyPaystackSignature } from '../infrastructure/PaystackClient.js';

const TERMINAL_FAILURE = new Set(['failed', 'abandoned', 'reversed']);

/** Atomically claim a Paystack charge and credit the wallet exactly once. */
export const creditPaystackIntent = async ({ deposits, intent, payload, notifier = null }) => {
  const claimed = await runInTransaction(async (session) => {
    const opt = session ? { session } : {};
    const doc = await deposits.findOneAndUpdate(
      { _id: intent._id, status: { $ne: 'success' } },
      { $set: { status: 'success', creditedAt: new Date(), lastCallback: payload } },
      { new: false, ...opt },
    ).lean();
    if (!doc) return null;
    await creditPartnerWallet(
      { partners: PartnersModel, transactions: TransactionModel },
      {
        partnerId: doc.partnerId,
        amountNgn: doc.amountNgn,
        paymentMethod: 'Paystack Deposit',
        reference: doc.reference,
      },
      opt,
    );
    return doc;
  });

  if (notifier && claimed) {
    await notifier(claimed.partnerId, claimed.amountNgn, claimed.reference).catch(() => null);
  }
  return { status: 'success', deduped: !claimed, reference: intent.reference };
};

/**
 * POST /v1/billing/deposit/paystack/init — hosted Paystack checkout.
 * Amount, reference and callback are all server-owned.
 */
export class InitPaystackDepositUseCase {
  constructor({ deposits, paystack, partners, urls } = {}) {
    this.deposits = deposits ?? DepositIntentModel;
    this.paystack = paystack;
    this.partners = partners ?? PartnersModel;
    this.urls = urls ?? {};
  }

  async execute({ partnerId, amountNgn, contact = {} }) {
    const amount = assertDepositAmount(amountNgn);
    if (!this.paystack?.enabled) {
      throw new AppError('Paystack deposits are not available right now', 503, 'PAYSTACK_DISABLED');
    }
    const member = await this.partners.findById(partnerId).select('name surname username email phone').lean();
    if (!member) throw new NotFoundException('Partner not found');

    const amountKobo = toKobo(amount);
    let reference = newDepositReference();
    let intent = await this.deposits.create({
      reference,
      partnerId,
      amountNgn: amount,
      amountKobo,
      method: 'paystack',
      status: 'created',
    }).catch(async (err) => {
      if (err?.code !== 11000) throw err;
      reference = newDepositReference();
      return this.deposits.create({
        reference, partnerId, amountNgn: amount, amountKobo, method: 'paystack', status: 'created',
      });
    });

    const name = [member.name, member.surname].filter(Boolean).join(' ') || member.username || 'Partner';
    const email = String(contact.email ?? member.email ?? '').trim();
    if (!email) {
      await this.deposits.updateOne({ _id: intent._id }, { $set: { status: 'failed' } }).catch(() => null);
      throw new ValidationException('Add an email address before paying');
    }

    let opened;
    try {
      opened = await this.paystack.initialize({
        reference,
        amountKobo,
        email,
        callbackUrl: this.urls.returnUrl
          ? `${this.urls.returnUrl}?reference=${encodeURIComponent(reference)}`
          : undefined,
        metadata: {
          partnerId: String(partnerId),
          name: contact.name ?? name,
          phone: contact.phone ?? member.phone ?? '',
          product: 'wallet-top-up',
        },
      });
    } catch (err) {
      await this.deposits.updateOne({ _id: intent._id }, { $set: { status: 'failed' } }).catch(() => null);
      throw new ValidationException(`Could not open Paystack checkout: ${err?.message ?? 'provider error'}`);
    }

    intent = await this.deposits.findByIdAndUpdate(
      intent._id,
      {
        $set: {
          status: 'pending',
          accessCode: opened.accessCode,
          authorizationUrl: opened.authorizationUrl,
          orderNo: opened.reference ?? reference,
        },
      },
      { new: true },
    );

    return {
      reference,
      checkoutUrl: opened.authorizationUrl,
      amountNgn: amount,
      accessCode: opened.accessCode,
      expiresInMinutes: 30,
      intent: { id: String(intent._id), status: intent.status },
    };
  }
}

/**
 * POST /v1/billing/deposit/paystack/webhook — public, signature-verified.
 * Paystack retries failed pushes; only a bad signature or unknown reference
 * gets a non-2xx response.
 */
export class HandlePaystackWebhookUseCase {
  constructor({ deposits, paystack, notifier = null, transferHandler = null } = {}) {
    this.deposits = deposits ?? DepositIntentModel;
    this.paystack = paystack;
    this.notifier = notifier;
    this.transferHandler = transferHandler;
  }

  async execute({ payload, rawBody, signature }) {
    if (!verifyPaystackSignature(rawBody, signature, this.paystack?.secretKey)) {
      const err = new Error('Invalid Paystack webhook signature');
      err.code = 'BAD_SIGNATURE';
      throw err;
    }
    const event = String(payload?.event ?? '');
    if (event.startsWith('transfer.')) {
      if (!this.transferHandler) return { status: 'ignored', event };
      return this.transferHandler.execute({ payload });
    }
    if (event !== 'charge.success') return { status: 'ignored', event };

    const data = payload?.data ?? {};
    const reference = String(data.reference ?? '');
    const intent = await this.deposits.findOne({ reference, method: 'paystack' }).lean();
    if (!intent) {
      const err = new Error(`Unknown Paystack reference ${reference}`);
      err.code = 'UNKNOWN_REFERENCE';
      throw err;
    }
    if (intent.status === 'success') return { status: 'success', deduped: true, reference };

    // Cross-check the signed event against Paystack before moving money.
    let live;
    try {
      live = await this.paystack.verify(reference);
    } catch (err) {
      console.error(`[paystack] verify failed for ${reference}: ${err?.message ?? err}`);
      throw err;
    }
    if (String(live?.status ?? '').toLowerCase() !== 'success') {
      return { status: 'pending', reference };
    }
    if (Number(live.amount) !== Number(intent.amountKobo) || String(live.currency ?? 'NGN').toUpperCase() !== 'NGN') {
      const err = new Error('Paystack amount or currency does not match the deposit intent');
      err.code = 'AMOUNT_MISMATCH';
      throw err;
    }

    const payloadForStore = { event, data: live };
    return creditPaystackIntent({
      deposits: this.deposits,
      intent,
      payload: payloadForStore,
      notifier: this.notifier,
    });
  }
}

/** GET /v1/billing/deposit/status — confirms and credits a Paystack intent. */
export class PaystackDepositStatusUseCase {
  constructor({ deposits, paystack, notifier = null } = {}) {
    this.deposits = deposits ?? DepositIntentModel;
    this.paystack = paystack;
    this.notifier = notifier;
  }

  async execute({ partnerId, reference }) {
    const intent = await this.deposits.findOne({
      reference: String(reference ?? ''),
      partnerId,
      method: 'paystack',
    }).lean();
    if (!intent) throw new NotFoundException('Deposit not found');

    let live = null;
    if (intent.status !== 'success' && this.paystack?.enabled) {
      try {
        live = await this.paystack.verify(intent.reference);
      } catch {
        live = null;
      }
    }

    if (live && String(live.status ?? '').toLowerCase() === 'success') {
      if (Number(live.amount) !== Number(intent.amountKobo) || String(live.currency ?? 'NGN').toUpperCase() !== 'NGN') {
        throw new ConflictException('Paystack amount or currency does not match this deposit');
      }
      await creditPaystackIntent({
        deposits: this.deposits,
        intent,
        payload: { event: 'charge.success', data: live },
        notifier: this.notifier,
      });
      return {
        reference: intent.reference,
        status: 'success',
        amountNgn: intent.amountNgn,
        orderNo: intent.orderNo ?? null,
        creditedAt: intent.creditedAt ?? new Date().toISOString(),
        liveStatus: String(live.status ?? 'success').toUpperCase(),
      };
    }

    if (live && TERMINAL_FAILURE.has(String(live.status ?? '').toLowerCase())) {
      await this.deposits.updateOne({ _id: intent._id }, { $set: { status: 'failed', lastCallback: { data: live } } }).catch(() => null);
    }

    return {
      reference: intent.reference,
      status: live && TERMINAL_FAILURE.has(String(live.status ?? '').toLowerCase()) ? 'failed' : intent.status,
      amountNgn: intent.amountNgn,
      orderNo: intent.orderNo ?? null,
      creditedAt: intent.creditedAt ?? null,
      liveStatus: live?.status ? String(live.status).toUpperCase() : null,
    };
  }
}
