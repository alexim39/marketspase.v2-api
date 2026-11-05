import { TransactionModel } from '../apps/transaction/models/transaction.model.js';
import { PaystackClient } from '../modules/billing/infrastructure/PaystackClient.js';
import { applyTransferVerification, refundWithdrawal } from '../modules/billing/application/PaystackPayout.usecases.js';
import { notifyPayoutOutcome } from '../modules/billing/application/Payout.notifier.js';

/**
 * Reconcile automatic withdrawals whose webhook has not arrived. This is the
 * safety net that keeps payouts seamless when Paystack retries are delayed:
 * verify the transfer by our reference, then apply Paid or Rejected+refund
 * through the same atomic state transitions the webhook uses.
 */
export const runPayoutReconcileJob = async (deps = {}) => {
  const paystack = deps.paystack ?? new PaystackClient();
  const transactions = deps.transactions ?? TransactionModel;
  const notifier = deps.notifier ?? notifyPayoutOutcome;
  const started = Date.now();
  let checked = 0;
  let settled = 0;
  let failed = 0;

  if (!paystack.enabled) return { checked, settled, failed };
  const cutoff = new Date(Date.now() - 2 * 60 * 1000);
  const rows = await transactions.find({
    paymentMethod: 'Withdrawal',
    status: 'Pending',
    payoutMode: 'automatic',
    payoutInitiatedAt: { $lte: cutoff },
    $or: [{ transferCode: { $ne: null } }, { transferStatus: 'processing' }],
  }).sort({ payoutInitiatedAt: 1 }).limit(50).lean();

  for (const tx of rows) {
    try {
      const live = await paystack.verifyTransfer(tx.reference);
      const result = await applyTransferVerification({
        transactions,
        partners: deps.partners,
        tx,
        live,
      });
      checked += 1;
      if (result.status === 'paid' || result.status === 'refunded') {
        settled += 1;
        await notifier({
          partnerId: tx.partnerId,
          amountNgn: tx.amount,
          reference: tx.reference,
          outcome: result.status === 'paid' ? 'paid' : 'refunded',
          payoutMode: 'automatic',
          reason: result.reason ?? null,
          bank: tx.bank,
          accountName: tx.accountName,
        }).catch(() => null);
      }
    } catch (error) {
      // The transfer was never created (crash after the wallet debit, before
      // initiation). After a grace period, refund instead of stranding money.
      if (
        error?.code === 'TRANSFER_NOT_FOUND'
        && !tx.transferCode
        && tx.payoutInitiatedAt
        && new Date(tx.payoutInitiatedAt).getTime() < Date.now() - 10 * 60 * 1000
      ) {
        const refunded = await refundWithdrawal({
          transactions,
          partners: deps.partners,
          txId: tx._id,
          reason: 'Payout was not created — refunded automatically',
          transferStatus: 'failed',
          note: 'Automatic payout was not created; wallet refunded',
        });
        if (refunded) {
          settled += 1;
          await notifier({
            partnerId: tx.partnerId,
            amountNgn: tx.amount,
            reference: tx.reference,
            outcome: 'refunded',
            payoutMode: 'automatic',
            reason: 'The payout was not created.',
            bank: tx.bank,
            accountName: tx.accountName,
          }).catch(() => null);
        }
        continue;
      }
      failed += 1;
      console.error(`[jobs] payout-reconcile ${tx.reference}: ${error?.message ?? error}`);
    }
  }

  console.log(
    `[jobs] payout-reconcile: ${settled}/${checked} settled (${failed} failed) in ${Date.now() - started}ms`,
  );
  return { checked, settled, failed };
};
