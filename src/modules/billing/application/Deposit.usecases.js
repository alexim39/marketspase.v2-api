import { AppError, ConflictException, ValidationException, NotFoundException } from '../../../shared/domain/AppError.js';
import {
  assertAdminCreditAmount, assertDepositAmount, assertManualClaim,
  manualAccounts, newDepositReference, toKobo,
} from '../domain/Deposit.js';
import { verifyCallbackSignature } from '../infrastructure/OpayClient.js';
import { DepositIntentModel } from '../infrastructure/Deposit.mongo.model.js';
import { PartnersModel, TransactionModel, runInTransaction } from '../infrastructure/Billing.models.js';

/**
 * POST /v1/billing/deposit/init — open a cashier session for a top-up.
 * Amount comes from the member but is re-validated + converted server-side;
 * the reference is ours (unique), never the client's.
 */
export class InitDepositUseCase {
  /** @param {{deposits, opay, partners, urls}} deps */
  constructor({ deposits, opay, partners, urls }) {
    Object.assign(this, {
      deposits: deposits ?? DepositIntentModel,
      opay,
      partners: partners ?? PartnersModel,
      urls: urls ?? {},
    });
  }

  async execute({ partnerId, amountNgn, contact = {} }) {
    const amount = assertDepositAmount(amountNgn);
    if (!this.opay?.enabled) {
      throw new AppError('Deposits are not available right now', 503, 'DEPOSITS_DISABLED');
    }
    const member = await this.partners.findById(partnerId).select('name surname email phone').lean();
    if (!member) throw new NotFoundException('Partner not found');

    const amountKobo = toKobo(amount);
    let reference = newDepositReference();
    let intent = await this.deposits.create({
      reference, partnerId, amountNgn: amount, amountKobo, status: 'created',
    }).catch(async (err) => {
      if (err?.code !== 11000) throw err;
      reference = newDepositReference();
      return this.deposits.create({ reference, partnerId, amountNgn: amount, amountKobo, status: 'created' });
    });

    const name = [member.name, member.surname].filter(Boolean).join(' ') || member.username;
    let opened;
    try {
      opened = await this.opay.createCashier({
        reference,
        amountKobo,
        email: contact.email ?? member.email ?? '',
        name: contact.name ?? name,
        phone: contact.phone ?? member.phone ?? '',
        userId: String(partnerId),
        callbackUrl: this.urls.callbackUrl ?? null,
        returnUrl: this.urls.returnUrl ? `${this.urls.returnUrl}?reference=${reference}` : null,
        cancelUrl: this.urls.cancelUrl ?? this.urls.returnUrl ?? null,
      });
    } catch (err) {
      await this.deposits.updateOne({ _id: intent._id }, { $set: { status: 'failed' } }).catch(() => null);
      throw new ValidationException(`Could not open checkout: ${err?.message ?? 'gateway error'}`);
    }
    intent = await this.deposits.findByIdAndUpdate(
      intent._id,
      { $set: { status: 'pending', orderNo: opened.orderNo ?? null } },
      { new: true },
    ).lean();
    return {
      reference,
      orderNo: opened.orderNo ?? null,
      cashierUrl: opened.cashierUrl,
      amountNgn: amount,
      expiresInMinutes: 30,
      intent: { id: String(intent._id), status: intent.status },
    };
  }
}

/**
 * POST /v1/billing/deposit/callback — PUBLIC Opay webhook.
 * Order of operations is the security model: verify signature →
 * load intent → cross-check via query-status → credit once →
 * always answer 200 (Opay retries non-2xx for 72h; idempotency makes
 * retries safe, failures loud in logs instead).
 */
export class HandleDepositCallbackUseCase {
  /** @param {{deposits, opay, privateKey, notifier?}} deps */
  constructor({ deposits, opay, privateKey, notifier = null }) {
    Object.assign(this, { deposits: deposits ?? DepositIntentModel, opay, privateKey, notifier });
  }

  async execute({ payload, sha512 }) {
    if (!verifyCallbackSignature(payload, sha512, this.privateKey ?? '')) {
      const err = new Error('Invalid callback signature');
      err.code = 'BAD_SIGNATURE';
      throw err;
    }
    const reference = String(payload?.reference ?? '');
    const intent = await this.deposits.findOne({ reference }).lean();
    if (!intent) {
      const err = new Error(`Unknown deposit reference ${reference}`);
      err.code = 'UNKNOWN_REFERENCE';
      throw err;
    }
    if (intent.status === 'success') return { status: 'success', deduped: true, reference };

    // Docs-recommended cross-verification before trusting the push.
    let live = null;
    try {
      live = await this.opay.queryStatus(reference);
    } catch (err) {
      console.error(`[deposit] status cross-check failed for ${reference}: ${err?.message ?? err}`);
    }
    const success = String(payload?.status ?? '').toUpperCase() === 'SUCCESS'
      && (!live || String(live.status ?? '').toUpperCase() === 'SUCCESS');
    if (!success) {
      const terminal = ['FAIL', 'CLOSE'].includes(String(live?.status ?? payload?.status ?? '').toUpperCase());
      await this.deposits.updateOne({ _id: intent._id }, {
        $set: { status: terminal ? 'failed' : intent.status, lastCallback: payload },
      }).catch(() => null);
      return { status: terminal ? 'failed' : intent.status, reference, verifiedLive: !!live };
    }

    // Credit exactly once: atomically claim the intent (status flip) and
    // only the claim winner credits. Retries and concurrent callbacks
    // converge on `deduped: true` instead of double credit.
    const claimed = await runInTransaction(async (session) => {
      const opt = session ? { session } : {};
      const doc = await this.deposits.findOneAndUpdate(
        { _id: intent._id, status: { $ne: 'success' } },
        { $set: { status: 'success', creditedAt: new Date(), lastCallback: payload } },
        { new: false, ...opt },
      ).lean().catch(() => null);
      if (!doc) return null;
      await PartnersModel.findByIdAndUpdate(
        doc.partnerId,
        { $inc: { balance: doc.amountNgn } },
        opt,
      );
      await TransactionModel.create([{
        partnerId: doc.partnerId,
        amount: doc.amountNgn,
        status: 'Completed',
        paymentMethod: 'Opay Deposit',
        transactionType: 'Credit',
        reference: doc.reference,
      }], opt);
      return doc;
    }).catch(() => null);
    const deduped = !claimed;

    if (this.notifier && claimed) {
      await this.notifier(intent.partnerId, intent.amountNgn, reference).catch(() => null);
    }
    return { status: 'success', deduped, reference };
  }
}

/** GET /v1/billing/deposit/status — owner-scoped intent + live refresh. */
export class DepositStatusUseCase {
  /** @param {{deposits, opay}} deps */
  constructor({ deposits, opay }) {
    Object.assign(this, { deposits: deposits ?? DepositIntentModel, opay });
  }

  async execute({ partnerId, reference }) {
    const intent = await this.deposits.findOne({
      reference: String(reference ?? ''),
      partnerId,
    }).lean();
    if (!intent) throw new NotFoundException('Deposit not found');
    let live = null;
    if (intent.status !== 'success' && this.opay?.enabled) {
      try {
        live = await this.opay.queryStatus(intent.reference);
      } catch {
        live = null; // stored state below still answers
      }
    }
    return {
      reference: intent.reference,
      status: intent.status,
      amountNgn: intent.amountNgn,
      orderNo: intent.orderNo ?? null,
      creditedAt: intent.creditedAt ?? null,
      liveStatus: live?.status ?? null,
    };
  }
}

/**
 * Shared wallet-credit core — the ONE place money enters a wallet for
 * deposits (gateway callback path keeps its own claim-flip; manual approve
 * and admin credit both land here). $inc + Completed/Credit record travel
 * together inside the caller's transaction.
 */
export const creditPartnerWallet = async ({ partners, transactions }, { partnerId, amountNgn, paymentMethod, reference }, opts = {}) => {
  const updated = await partners.findByIdAndUpdate(
    partnerId,
    { $inc: { balance: amountNgn } },
    { new: true, ...opts },
  );
  if (!updated) throw new NotFoundException('Partner not found');
  // NOTE: array form is mandatory — Mongoose ignores a `session` passed
  // with a single doc (and misreads the args). Single-doc create here once
  // masked every approval behind a false 409.
  const made = await transactions.create([{
    partnerId,
    amount: amountNgn,
    status: 'Completed',
    paymentMethod,
    transactionType: 'Credit',
    reference,
  }], opts);
  const tx = Array.isArray(made) ? made[0] : made;
  return { transactionId: String(tx._id ?? tx.id), balance: updated.balance ?? null };
};

/**
 * POST /v1/billing/deposit/manual — file a manual-transfer claim.
 * No money moves: the row waits in `awaiting-review` for an admin.
 */
export class SubmitManualDepositUseCase {
  /** @param {{deposits, partners, accounts?}} deps */
  constructor({ deposits, partners, accounts = null }) {
    Object.assign(this, {
      deposits: deposits ?? DepositIntentModel,
      partners: partners ?? PartnersModel,
      accounts: accounts ?? manualAccounts(),
    });
  }

  async execute({ partnerId, claim }) {
    const clean = assertManualClaim(claim ?? {}, this.accounts);
    const member = await this.partners.findById(partnerId).select('_id').lean();
    if (!member) throw new NotFoundException('Partner not found');
    const reference = newDepositReference();
    const intent = await this.deposits.create({
      reference,
      partnerId,
      amountNgn: clean.amountNgn,
      amountKobo: toKobo(clean.amountNgn),
      method: 'manual',
      status: 'awaiting-review',
      claim: {
        destinationAccount: clean.destinationAccount,
        senderName: clean.senderName,
        senderAccount: clean.senderAccount,
        paidAt: clean.paidAt,
        bankReference: clean.bankReference,
        ...(clean.note ? { note: clean.note } : {}),
      },
    });
    return { reference, amountNgn: clean.amountNgn, status: intent.status ?? 'awaiting-review' };
  }
}

/** GET /v1/billing/deposit/manual/mine — own manual claims, newest first. */
export class MyManualClaimsUseCase {
  /** @param {{deposits}} deps */
  constructor({ deposits }) {
    this.deposits = deposits ?? DepositIntentModel;
  }

  async execute({ partnerId, limit = 50 }) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const rows = await this.deposits
      .find({ partnerId, method: 'manual' })
      .sort({ createdAt: -1 })
      .limit(lim)
      .lean();
    return rows.map((d) => ({
      reference: d.reference,
      amountNgn: d.amountNgn,
      status: d.status,
      claim: d.claim ?? null,
      decidedAt: d.decidedAt ?? null,
      decisionNote: d.decisionNote ?? null,
      creditedAt: d.creditedAt ?? null,
      createdAt: d.createdAt,
    }));
  }
}

const claimShape = (d) => ({
  reference: d.reference,
  amountNgn: d.amountNgn,
  status: d.status,
  claim: d.claim ?? null,
  decidedBy: d.decidedBy ? String(d.decidedBy) : null,
  decidedAt: d.decidedAt ?? null,
  decisionNote: d.decisionNote ?? null,
  creditedAt: d.creditedAt ?? null,
  createdAt: d.createdAt,
});

/** GET /v1/billing/deposit/manual/queue — admin review queue. */
export class ListManualQueueUseCase {
  /** @param {{deposits, partners}} deps */
  constructor({ deposits, partners }) {
    Object.assign(this, {
      deposits: deposits ?? DepositIntentModel,
      partners: partners ?? PartnersModel,
    });
  }

  async execute({ status = 'awaiting-review', limit = 100 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const filter = { method: 'manual' };
    if (status && status !== 'all') filter.status = status;
    const rows = await this.deposits.find(filter).sort({ createdAt: -1 }).limit(lim).lean();
    const ids = [...new Set(rows.map((r) => String(r.partnerId)))];
    const owners = await this.partners
      .find({ _id: { $in: ids } })
      .select('name surname email phone username')
      .lean().catch(() => []);
    const labels = Object.fromEntries((owners ?? []).map((o) => [String(o._id), {
      name: [o.name, o.surname].filter(Boolean).join(' ') || o.username,
      email: o.email ?? null,
      phone: o.phone ?? null,
      username: o.username ?? null,
    }]));
    return rows.map((d) => ({ ...claimShape(d), partner: labels[String(d.partnerId)] ?? null }));
  }
}

/**
 * POST /v1/billing/deposit/manual/:reference/decide — approve (credit once)
 * or reject (reason required). The status flip filters on
 * `awaiting-review`, so concurrent approves converge on one winner and the
 * loser gets a clean 409 instead of a double credit.
 */
export class DecideManualDepositUseCase {
  /** @param {{deposits, partners, transactions, notifier?, rejectNotifier?}} deps */
  constructor({ deposits, partners, transactions, notifier = null, rejectNotifier = null }) {
    Object.assign(this, {
      deposits: deposits ?? DepositIntentModel,
      partners: partners ?? PartnersModel,
      transactions: transactions ?? TransactionModel,
      notifier,
      rejectNotifier,
    });
  }

  async execute({ reference, adminId, decision, note = '' }) {
    const ref = String(reference ?? '').trim();
    if (!ref) throw new ValidationException('Deposit reference is required');
    if (decision !== 'approve' && decision !== 'reject') {
      throw new ValidationException('Decision must be approve or reject');
    }
    const cleanNote = String(note ?? '').trim().slice(0, 500);
    if (decision === 'reject' && cleanNote.length < 3) {
      throw new ValidationException('A reason is required to reject a claim');
    }
    // Honest errors, never a masked 409: unknown reference → 404,
    // already-decided → 409, anything unexpected propagates (logged by
    // errorMiddleware) instead of being swallowed into a false 409.
    const existing = await this.deposits.findOne({ reference: ref, method: 'manual' }).lean().catch(() => null);
    if (!existing) throw new NotFoundException('Claim does not exist');
    if (existing.status !== 'awaiting-review') throw new ConflictException('Claim was already decided');
    const won = await runInTransaction(async (session) => {
      const opt = session ? { session } : {};
      const doc = await this.deposits.findOneAndUpdate(
        { reference: ref, method: 'manual', status: 'awaiting-review' },
        {
          $set: {
            status: decision === 'approve' ? 'approved' : 'rejected',
            decidedBy: adminId,
            decidedAt: new Date(),
            ...(cleanNote ? { decisionNote: cleanNote } : {}),
            ...(decision === 'approve' ? { creditedAt: new Date() } : {}),
          },
        },
        { new: false, ...opt },
      ).lean().catch(() => null);
      if (!doc) return null;
      let credit = null;
      if (decision === 'approve') {
        credit = await creditPartnerWallet(
          { partners: this.partners, transactions: this.transactions },
          {
            partnerId: doc.partnerId,
            amountNgn: doc.amountNgn,
            paymentMethod: 'Manual Transfer',
            reference: doc.reference,
          },
          opt,
        );
      }
      return { doc, credit };
    });
    // Null = lost a concurrent-decide race after the pre-check above.
    if (!won) throw new ConflictException('Claim was already decided');
    if (decision === 'approve' && this.notifier) {
      await this.notifier(won.doc.partnerId, won.doc.amountNgn, ref).catch(() => null);
    }
    if (decision === 'reject' && this.rejectNotifier) {
      await this.rejectNotifier(won.doc.partnerId, won.doc.amountNgn, ref, cleanNote).catch(() => null);
    }
    return {
      reference: ref,
      status: decision === 'approve' ? 'approved' : 'rejected',
      amountNgn: won.doc.amountNgn,
      transactionId: won.credit?.transactionId ?? null,
      balance: won.credit?.balance ?? null,
    };
  }
}

/**
 * POST /v1/admin/wallet/credit — direct admin top-up.
 * Reason is mandatory and audited at the route; the credit itself writes
 * an approved manual intent row so the ledger tells one story.
 */
export class AdminCreditWalletUseCase {
  /** @param {{deposits, partners, transactions, notifier?}} deps */
  constructor({ deposits, partners, transactions, notifier = null }) {
    Object.assign(this, {
      deposits: deposits ?? DepositIntentModel,
      partners: partners ?? PartnersModel,
      transactions: transactions ?? TransactionModel,
      notifier,
    });
  }

  async execute({ adminId, partnerId, amountNgn, reason }) {
    const amount = assertAdminCreditAmount(amountNgn);
    const cleanReason = String(reason ?? '').trim().slice(0, 500);
    if (cleanReason.length < 5) throw new ValidationException('A reason (min 5 characters) is required');
    const member = await this.partners.findById(partnerId).select('_id').lean();
    if (!member) throw new NotFoundException('Partner not found');
    const reference = newDepositReference();
    const out = await runInTransaction(async (session) => {
      const opt = session ? { session } : {};
      await this.deposits.create([{
        reference,
        partnerId,
        amountNgn: amount,
        amountKobo: toKobo(amount),
        method: 'manual',
        status: 'approved',
        creditedAt: new Date(),
        decidedBy: adminId,
        decidedAt: new Date(),
        decisionNote: `Admin credit: ${cleanReason}`,
      }], opt);
      return creditPartnerWallet(
        { partners: this.partners, transactions: this.transactions },
        { partnerId, amountNgn: amount, paymentMethod: 'Admin Credit', reference },
        opt,
      );
    });
    if (this.notifier) {
      await this.notifier(partnerId, amount, reference).catch(() => null);
    }
    return { reference, amountNgn: amount, ...out };
  }
}

const escapeRegExp = (s) => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Admin alert recipients: role-admin emails + configured extras, deduped. */
export const resolveAdminEmails = async ({ partners }, extra = []) => {
  const docs = await partners
    .find({ role: new RegExp('^admin$', 'i') })
    .select('email')
    .lean().catch(() => []);
  const mails = new Set();
  for (const d of docs ?? []) {
    const email = String(d?.email ?? '').trim().toLowerCase();
    if (email.includes('@')) mails.add(email);
  }
  for (const e of extra ?? []) {
    const email = String(e ?? '').trim().toLowerCase();
    if (email.includes('@')) mails.add(email);
  }
  return [...mails];
};

/** GET /v1/admin/wallet/lookup — find a partner to credit (email/username). */
export class LookupPartnerUseCase {  /** @param {{partners}} deps */
  constructor({ partners }) {
    this.partners = partners ?? PartnersModel;
  }

  async execute({ q }) {
    const needle = String(q ?? '').trim();
    if (needle.length < 2) throw new ValidationException('Enter at least 2 characters to search');
    const fields = 'name surname email phone username balance';
    const exact = await this.partners.findOne({
      $or: [
        { email: needle.toLowerCase() },
        { username: new RegExp(`^${escapeRegExp(needle)}$`, 'i') },
      ],
    }).select(fields).lean().catch(() => null);
    if (exact) return { exact: safePartner(exact), matches: [] };
    const rx = new RegExp(escapeRegExp(needle), 'i');
    const matches = await this.partners.find({
      $or: [{ email: rx }, { username: rx }],
    }).select(fields).limit(5).lean().catch(() => []);
    return { exact: null, matches: (matches ?? []).map(safePartner) };
  }
}

const safePartner = (p) => ({
  id: String(p._id ?? p.id),
  name: [p.name, p.surname].filter(Boolean).join(' ') || p.username,
  email: p.email ?? null,
  phone: p.phone ?? null,
  username: p.username ?? null,
  balance: Number(p.balance ?? 0),
});
