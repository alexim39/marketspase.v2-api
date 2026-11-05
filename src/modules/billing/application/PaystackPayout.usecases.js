import { PartnersModel, TransactionModel, runInTransaction } from '../infrastructure/Billing.models.js';

const WITHDRAWAL = 'Withdrawal';
const REFUND_METHOD = 'Withdrawal Refund';

const newRefundReference = () =>
  `RF${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

/**
 * Pending → Paid. Only a Pending row can transition, so a duplicate webhook
 * or a reconciliation run can never pay the same withdrawal twice.
 */
export const markWithdrawalPaid = async ({
  transactions = TransactionModel,
  txId,
  transferCode = null,
  transferStatus = 'success',
  note = 'Automatic Paystack transfer',
}) => {
  const set = {
    status: 'Paid',
    transferStatus,
    payoutCompletedAt: new Date(),
    decidedAt: new Date(),
    decisionNote: note,
  };
  if (transferCode) set.transferCode = transferCode;
  return transactions.findOneAndUpdate(
    { _id: txId, paymentMethod: WITHDRAWAL, status: 'Pending' },
    { $set: set },
    { new: true },
  );
};

/**
 * Pending → Rejected + full wallet refund in one transaction. The state claim
 * is atomic; a second failure event cannot refund twice.
 */
export const refundWithdrawal = async ({
  transactions = TransactionModel,
  partners = PartnersModel,
  txId,
  reason,
  transferStatus = 'failed',
  note = null,
  session = null,
}) => {
  const apply = async (activeSession) => {
    const opt = activeSession ? { session: activeSession } : {};
    const tx = await transactions.findOneAndUpdate(
      { _id: txId, paymentMethod: WITHDRAWAL, status: 'Pending' },
      {
        $set: {
          status: 'Rejected',
          transferStatus,
          payoutFailureReason: String(reason ?? '').slice(0, 300) || null,
          decidedAt: new Date(),
          decisionNote: String(note ?? reason ?? 'Automatic payout failed').slice(0, 500),
        },
      },
      { new: true, ...opt },
    );
    if (!tx) return null;

    const amount = Number(tx.amount);
    if (amount > 0) {
      await partners.updateOne(
        { _id: tx.partnerId },
        { $inc: { balance: amount } },
        opt,
      );
      await transactions.create([{
        partnerId: tx.partnerId,
        amount,
        status: 'Completed',
        paymentMethod: REFUND_METHOD,
        transactionType: 'Credit',
        reference: newRefundReference(),
      }], opt);
    }
    return tx;
  };

  if (session) return apply(session);
  return runInTransaction(apply);
};

/** Apply a Paystack verify payload to a Pending automatic withdrawal. */
export const applyTransferVerification = async ({
  transactions = TransactionModel,
  partners = PartnersModel,
  tx,
  live,
}) => {
  const status = String(live?.status ?? '').toLowerCase();
  if (status === 'success') {
    const updated = await markWithdrawalPaid({
      transactions,
      txId: tx._id,
      transferCode: live?.transfer_code ?? tx.transferCode ?? null,
      transferStatus: 'success',
    });
    return updated
      ? { status: 'paid', tx: updated }
      : { status: 'deduped', tx };
  }
  if (status === 'failed' || status === 'reversed') {
    const reason = String(live?.gateway_response ?? live?.message ?? `Paystack transfer ${status}`).slice(0, 300);
    const updated = await refundWithdrawal({
      transactions,
      partners,
      txId: tx._id,
      reason,
      transferStatus: status,
      note: `Automatic payout ${status}: ${reason}`,
    });
    return updated
      ? { status: 'refunded', tx: updated, reason }
      : { status: 'deduped', tx };
  }
  return { status: 'pending', tx };
};

/**
 * Paystack transfer webhook. The signed payload is already verified by the
 * caller (the same handler that processes charge.success). Unknown transfers
 * are ignored with 200 so manual dashboard transfers never cause retries.
 */
export class HandlePaystackTransferUseCase {
  constructor({ transactions = TransactionModel, partners = PartnersModel, notifier = null } = {}) {
    this.transactions = transactions;
    this.partners = partners;
    this.notifier = notifier;
  }

  async execute({ payload }) {
    const event = String(payload?.event ?? '');
    const data = payload?.data ?? {};
    if (!event.startsWith('transfer.')) return { status: 'ignored', event };

    const reference = String(data.reference ?? '');
    const transferCode = String(data.transfer_code ?? '');
    if (!reference && !transferCode) return { status: 'ignored', event };

    const tx = await this.transactions.findOne({
      paymentMethod: WITHDRAWAL,
      payoutMode: 'automatic',
      ...(reference ? { reference } : { transferCode }),
    }).lean();
    if (!tx) return { status: 'ignored', event, reference };
    if (tx.status === 'Paid' || tx.status === 'Rejected') {
      // A reversal after settlement is exceptional (bank/closed account).
      // Flag it and alert the partner instead of silently ignoring it; the
      // wallet is not clawed back automatically.
      if (tx.status === 'Paid' && event === 'transfer.reversed') {
        const reason = String(data.gateway_response ?? data.message ?? 'Transfer reversed').slice(0, 300);
        await this.transactions.updateOne(
          { _id: tx._id, status: 'Paid' },
          { $set: { transferStatus: 'reversed', payoutFailureReason: reason } },
        ).catch(() => null);
        if (this.notifier) {
          await this.notifier({
            partnerId: tx.partnerId,
            amountNgn: tx.amount,
            reference: tx.reference,
            outcome: 'reversed',
            payoutMode: 'automatic',
            reason,
            bank: tx.bank,
            accountName: tx.accountName,
          }).catch(() => null);
        }
        return { status: 'reversed', reference: tx.reference, reason };
      }
      return { status: 'deduped', event, reference: tx.reference };
    }

    if (event === 'transfer.success') {
      const updated = await markWithdrawalPaid({
        transactions: this.transactions,
        txId: tx._id,
        transferCode: transferCode || tx.transferCode || null,
        transferStatus: 'success',
      });
      if (updated && this.notifier) {
        await this.notifier({
          partnerId: updated.partnerId,
          amountNgn: updated.amount,
          reference: updated.reference,
          outcome: 'paid',
          payoutMode: 'automatic',
          bank: updated.bank,
          accountName: updated.accountName,
        }).catch(() => null);
      }
      return { status: 'paid', deduped: !updated, reference: tx.reference };
    }

    if (event === 'transfer.failed' || event === 'transfer.reversed') {
      const reason = String(data.gateway_response ?? data.message ?? `Paystack transfer ${event.slice(9)}`).slice(0, 300);
      const updated = await refundWithdrawal({
        transactions: this.transactions,
        partners: this.partners,
        txId: tx._id,
        reason,
        transferStatus: event === 'transfer.reversed' ? 'reversed' : 'failed',
        note: `Automatic payout failed: ${reason}`,
      });
      if (updated && this.notifier) {
        await this.notifier({
          partnerId: updated.partnerId,
          amountNgn: updated.amount,
          reference: updated.reference,
          outcome: 'refunded',
          payoutMode: 'automatic',
          reason,
          bank: updated.bank,
          accountName: updated.accountName,
        }).catch(() => null);
      }
      return {
        status: 'refunded',
        deduped: !updated,
        reference: tx.reference,
        reason: updated ? reason : null,
      };
    }

    return { status: 'ignored', event };
  }
}
