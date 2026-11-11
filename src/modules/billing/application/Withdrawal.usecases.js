import { ConflictException, ValidationException } from '../../../shared/domain/AppError.js';
import { seal } from '../../../shared/security/fieldCrypto.js';
import { logger } from '../../../shared/observability/logger.js';
import { PartnersModel, TransactionModel, runInTransaction } from '../infrastructure/Billing.models.js';
import { markWithdrawalPaid, refundWithdrawal } from './PaystackPayout.usecases.js';

const MIN_WITHDRAWAL_NGN = 100;
const MAX_WITHDRAWAL_NGN = 1_000_000;

const newWithdrawalReference = () =>
  `WD${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

/**
 * POST /v1/billing/withdrawals — create a payout.
 *
 * The bank account is re-resolved with Paystack server-side, so the account
 * name cannot be forged by the browser. When automatic payout is enabled the
 * wallet is debited, a Paystack transfer is started, and the webhook (plus the
 * reconcile job) finishes the row as Paid or Rejected + refund. Setting
 * `autoPayout: false` keeps the older manual admin-review flow.
 */
export class CreateWithdrawalUseCase {
  constructor({ partners, transactions, paystack, notifier = null, autoPayout = true, savedAccounts = null } = {}) {
    this.partners = partners ?? PartnersModel;
    this.transactions = transactions ?? TransactionModel;
    this.paystack = paystack;
    this.notifier = notifier;
    this.autoPayout = autoPayout !== false;
    this.savedAccounts = savedAccounts;
  }

  async notify(payload) {
    if (!this.notifier) return;
    await this.notifier(payload).catch(() => null);
  }

  /**
   * Saving a payout preference is a convenience, never part of the money
   * movement. A database failure here must not fail a created withdrawal.
   */
  async persistSavedAccount({ partnerId, saveAccount, bankCode, bankName, accountName, accountNumber }) {
    if (!this.savedAccounts || saveAccount === undefined || saveAccount === null) return;
    try {
      if (saveAccount === true) {
        await this.savedAccounts.upsert(partnerId, {
          bankCode,
          bankName,
          accountName,
          accountNumber,
        });
      } else if (saveAccount === false) {
        await this.savedAccounts.remove(partnerId);
      }
    } catch (error) {
      logger.warn('saved_payout_account_persist_failed', {
        partnerId: String(partnerId),
        saveAccount,
        error: error?.message ?? String(error),
      });
    }
  }

  async execute({ partnerId, bankCode, bankName, accountNumber, amountNgn, saveAccount }) {
    if (!this.paystack?.enabled) {
      throw new ValidationException('Withdrawals are not available right now');
    }
    const bank = String(bankCode ?? '').trim();
    const account = String(accountNumber ?? '').replace(/\D/g, '');
    const amount = Math.round(Number(amountNgn) * 100) / 100;
    if (!bank) throw new ValidationException('Select your bank');
    if (!/^\d{10}$/.test(account)) throw new ValidationException('Enter a 10-digit account number');
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL_NGN) {
      throw new ValidationException(`Minimum withdrawal is ₦${MIN_WITHDRAWAL_NGN.toLocaleString()}`);
    }
    if (amount > MAX_WITHDRAWAL_NGN) {
      throw new ValidationException(`Maximum withdrawal is ₦${MAX_WITHDRAWAL_NGN.toLocaleString()}`);
    }

    let resolved;
    try {
      resolved = await this.paystack.resolveAccount(account, bank);
    } catch (err) {
      throw new ValidationException(err?.message ?? 'Account could not be resolved');
    }

    // The bank code is authoritative; take the display name from the live
    // directory so a forged client label can never reach the payout record.
    let bankLabel = String(bankName ?? '').trim();
    try {
      const banks = await this.paystack.listBanks();
      const match = (banks ?? []).find((entry) => entry.code === bank);
      if (match?.name) bankLabel = match.name;
    } catch { /* keep the client label; the code still identifies the bank */ }
    if (!bankLabel) bankLabel = bank;

    const reference = newWithdrawalReference();
    const amountKobo = Math.round(amount * 100);

    let recipient = null;
    if (this.autoPayout) {
      // Fail before touching the wallet when the payout balance cannot cover
      // this request. A stale/failed balance read is not fatal — the transfer
      // call remains the source of truth.
      const available = await this.paystack.availableBalanceKobo('NGN').catch(() => null);
      if (available !== null && available < amountKobo) {
        throw new ValidationException('Withdrawals are temporarily unavailable — try again later.');
      }
      try {
        recipient = await this.paystack.createTransferRecipient({
          name: resolved.accountName,
          accountNumber: account,
          bankCode: bank,
          description: `MarketSpase withdrawal ${reference}`,
        });
      } catch (err) {
        throw new ValidationException(err?.message ?? 'We could not set up this payout account — try again.');
      }
    }

    let outcome;
    try {
      outcome = await runInTransaction(async (session) => {
        const opt = session ? { session } : {};
        const partner = await this.partners.findOneAndUpdate(
          { _id: partnerId, balance: { $gte: amount } },
          { $inc: { balance: -amount } },
          { new: true, ...opt },
        );
        if (!partner) {
          throw new ConflictException('Your wallet balance is too low for this withdrawal');
        }
        const created = await this.transactions.create([{
          partnerId,
          amount,
          balanceBefore: Number(partner.balance ?? 0) + amount,
          balanceAfter: partner.balance ?? null,
          status: 'Pending',
          paymentMethod: 'Withdrawal',
          transactionType: 'Debit',
          bank: bankLabel,
          bankCode: bank,
          accountNumber: seal(account),
          accountLast4: account.slice(-4),
          accountName: resolved.accountName,
          reference,
          payoutMode: this.autoPayout ? 'automatic' : 'manual',
          transferRecipientCode: recipient?.recipientCode ?? null,
          transferStatus: this.autoPayout ? 'processing' : null,
          payoutInitiatedAt: this.autoPayout ? new Date() : null,
        }], opt);
        return {
          transaction: Array.isArray(created) ? created[0] : created,
          balance: partner.balance ?? null,
        };
      });
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      throw new ConflictException('Could not create the withdrawal — try again');
    }
    if (!outcome?.transaction) throw new ConflictException('Could not create the withdrawal — try again');

    const tx = outcome.transaction;
    const result = {
      reference,
      amountNgn: amount,
      balance: outcome.balance,
      bank: bankLabel,
      bankCode: bank,
      accountNumber: account,
      accountName: resolved.accountName,
    };
    const persistPreference = () => this.persistSavedAccount({
      partnerId,
      saveAccount,
      bankCode: bank,
      bankName: bankLabel,
      accountName: resolved.accountName,
      accountNumber: account,
    });

    if (!this.autoPayout) {
      await this.notify({
        partnerId, amountNgn: amount, reference, outcome: 'pending', payoutMode: 'manual',
        bank: bankLabel, accountName: resolved.accountName,
      });
      await persistPreference();
      return { ...result, status: 'Pending', payoutMode: 'manual', transferStatus: null, transferCode: null };
    }

    let transfer;
    try {
      transfer = await this.paystack.initiateTransfer({
        recipientCode: recipient.recipientCode,
        amountKobo,
        reference,
        reason: `MarketSpase withdrawal ${reference}`,
      });
    } catch (initError) {
      // A timeout can hide a transfer that Paystack actually created. Verify
      // the reference before refunding, so a retry never pays twice.
      let existing = null;
      try {
        existing = await this.paystack.verifyTransfer(reference);
      } catch { /* no transfer exists */ }
      if (existing) {
        transfer = {
          transferCode: existing.transfer_code ?? null,
          status: String(existing.status ?? 'pending').toLowerCase(),
          reference: existing.reference ?? reference,
          raw: existing,
        };
      } else {
        const reason = String(initError?.message ?? 'Payout could not be started').slice(0, 300);
        await refundWithdrawal({
          transactions: this.transactions,
          partners: this.partners,
          txId: tx._id,
          reason,
          transferStatus: 'failed',
          note: `Automatic payout failed: ${reason}`,
        });
        await this.notify({
          partnerId, amountNgn: amount, reference, outcome: 'refunded', payoutMode: 'automatic',
          reason, bank: bankLabel, accountName: resolved.accountName,
        });
        throw new ValidationException(`${reason} Your wallet was refunded.`);
      }
    }

    const transferStatus = String(transfer?.status ?? 'pending').toLowerCase();

    if (transferStatus === 'success') {
      const paid = await markWithdrawalPaid({
        transactions: this.transactions,
        txId: tx._id,
        transferCode: transfer.transferCode ?? null,
        transferStatus: 'success',
      });
      await this.notify({
        partnerId, amountNgn: amount, reference, outcome: 'paid', payoutMode: 'automatic',
        bank: bankLabel, accountName: resolved.accountName,
      });
      await persistPreference();
      return {
        ...result,
        status: 'Paid',
        payoutMode: 'automatic',
        transferStatus: 'success',
        transferCode: paid?.transferCode ?? transfer.transferCode ?? null,
      };
    }

    if (transferStatus === 'otp') {
      const reason = 'Paystack requires transfer OTP — automatic payouts are not enabled on this account';
      await refundWithdrawal({
        transactions: this.transactions,
        partners: this.partners,
        txId: tx._id,
        reason,
        transferStatus: 'otp',
        note: reason,
      });
      await this.notify({
        partnerId, amountNgn: amount, reference, outcome: 'refunded', payoutMode: 'automatic',
        reason, bank: bankLabel, accountName: resolved.accountName,
      });
      throw new ValidationException('Automatic payouts are not enabled yet — your wallet was refunded. Contact support.');
    }

    if (transferStatus === 'failed' || transferStatus === 'reversed') {
      const reason = String(transfer?.raw?.gateway_response ?? transfer?.raw?.message ?? `Paystack transfer ${transferStatus}`).slice(0, 300);
      await refundWithdrawal({
        transactions: this.transactions,
        partners: this.partners,
        txId: tx._id,
        reason,
        transferStatus,
        note: `Automatic payout failed: ${reason}`,
      });
      await this.notify({
        partnerId, amountNgn: amount, reference, outcome: 'refunded', payoutMode: 'automatic',
        reason, bank: bankLabel, accountName: resolved.accountName,
      });
      throw new ValidationException(`Payout failed — ${reason}. Your wallet was refunded.`);
    }

    // pending / processing / queued — the webhook or reconcile job finishes it.
    // Only update while still Pending so a fast webhook cannot be overwritten.
    const updated = await this.transactions.findOneAndUpdate(
      { _id: tx._id, status: 'Pending' },
      { $set: { transferCode: transfer.transferCode ?? null, transferStatus } },
      { new: true },
    );
    if (!updated) {
      const current = await this.transactions.findById(tx._id)
        .select('status transferStatus transferCode').lean();
      if (current?.status === 'Rejected') {
        throw new ValidationException('Payout failed — your wallet was refunded.');
      }
      if (current) {
        await persistPreference();
        return {
          ...result,
          status: current.status,
          payoutMode: 'automatic',
          transferStatus: current.transferStatus ?? transferStatus,
          transferCode: current.transferCode ?? transfer.transferCode ?? null,
        };
      }
    }
    await this.notify({
      partnerId, amountNgn: amount, reference, outcome: 'pending', payoutMode: 'automatic',
      bank: bankLabel, accountName: resolved.accountName,
    });
    await persistPreference();
    return {
      ...result,
      status: 'Pending',
      payoutMode: 'automatic',
      transferStatus,
      transferCode: updated?.transferCode ?? transfer.transferCode ?? null,
    };
  }
}

export { MIN_WITHDRAWAL_NGN, MAX_WITHDRAWAL_NGN };
