import 'dotenv/config';
import mongoose from 'mongoose';
import { open } from '../src/shared/security/fieldCrypto.js';
import { TransactionModel } from '../src/apps/transaction/models/transaction.model.js';
import { PaystackClient } from '../src/modules/billing/infrastructure/PaystackClient.js';
import {
  markWithdrawalPaid,
  refundWithdrawal,
} from '../src/modules/billing/application/PaystackPayout.usecases.js';
import { notifyPayoutOutcome } from '../src/modules/billing/application/Payout.notifier.js';

/**
 * Settle withdrawals that were created while the old manual-review mode was
 * enabled. Read-only by default. Set APPLY=1 to start the Paystack transfer.
 *
 * The row is claimed as automatic before the provider call so the normal
 * payout-reconcile job can recover a crash, and every step is idempotent by
 * the original withdrawal reference.
 */

const APPLY = process.env.APPLY === '1';
const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

await mongoose.connect(uri);
const paystack = new PaystackClient();

const rows = await TransactionModel.find({
  paymentMethod: 'Withdrawal',
  status: 'Pending',
  payoutMode: 'manual',
}).sort({ createdAt: 1 }).limit(100).lean();

if (rows.length === 0) {
  console.log('No pending manual withdrawals.');
  await mongoose.connection.close(false);
  process.exit(0);
}

const summary = [];
for (const row of rows) {
  const result = {
    reference: row.reference,
    amount: row.amount,
    bank: row.bank,
    last4: row.accountLast4,
    action: APPLY ? null : 'dry-run',
  };
  try {
    const account = open(row.accountNumber);
    if (!account) throw new Error('Stored account number could not be opened');

    const resolved = await paystack.resolveAccount(account, row.bankCode);
    const storedName = String(row.accountName ?? '').trim().toLowerCase();
    const liveName = String(resolved.accountName ?? '').trim().toLowerCase();
    if (storedName && liveName && storedName !== liveName) {
      throw new Error('Live account name does not match the stored destination');
    }

    let existing = null;
    try {
      existing = await paystack.verifyTransfer(row.reference);
    } catch (error) {
      if (error?.code !== 'TRANSFER_NOT_FOUND') throw error;
    }

    if (!APPLY) {
      result.action = existing
        ? `would reconcile existing transfer (${existing.status ?? 'unknown'})`
        : 'would create and start automatic transfer';
      summary.push(result);
      continue;
    }

    // Claim the row first. A crash from here is recoverable by the scheduled
    // payout-reconcile job because it is now an automatic in-flight withdrawal.
    const claimed = await TransactionModel.findOneAndUpdate(
      { _id: row._id, status: 'Pending', payoutMode: 'manual' },
      {
        $set: {
          payoutMode: 'automatic',
          transferStatus: 'processing',
          payoutInitiatedAt: new Date(),
        },
      },
      { new: true },
    ).lean();
    if (!claimed) {
      result.action = 'skipped — row changed before processing';
      summary.push(result);
      continue;
    }

    let transfer = existing
      ? {
        transferCode: existing.transfer_code ?? null,
        status: String(existing.status ?? 'pending').toLowerCase(),
        raw: existing,
      }
      : null;

    if (!transfer) {
      let recipient;
      try {
        recipient = await paystack.createTransferRecipient({
          name: resolved.accountName,
          accountNumber: account,
          bankCode: row.bankCode,
          description: `MarketSpase legacy manual withdrawal ${row.reference}`,
        });
        transfer = await paystack.initiateTransfer({
          recipientCode: recipient.recipientCode,
          amountKobo: Math.round(Number(row.amount) * 100),
          reference: row.reference,
          reason: `MarketSpase withdrawal ${row.reference}`,
        });
      } catch (error) {
        let hidden = null;
        try {
          hidden = await paystack.verifyTransfer(row.reference);
        } catch { /* no transfer exists */ }
        if (hidden) {
          transfer = {
            transferCode: hidden.transfer_code ?? null,
            status: String(hidden.status ?? 'pending').toLowerCase(),
            raw: hidden,
          };
        } else {
          const reason = String(error?.message ?? 'Paystack could not start the payout').slice(0, 300);
          await refundWithdrawal({
            txId: row._id,
            reason,
            transferStatus: 'failed',
            note: `Legacy manual withdrawal could not start automatically: ${reason}`,
          });
          await TransactionModel.updateOne(
            { _id: row._id },
            { $set: { payoutMode: 'automatic', transferRecipientCode: null } },
          );
          await notifyPayoutOutcome({
            partnerId: row.partnerId,
            amountNgn: row.amount,
            reference: row.reference,
            outcome: 'refunded',
            payoutMode: 'automatic',
            reason,
            bank: row.bank,
            accountName: resolved.accountName,
          });
          result.action = `refunded — ${reason}`;
          summary.push(result);
          continue;
        }
      }
    }

    const transferStatus = String(transfer.status ?? 'pending').toLowerCase();
    if (transferStatus === 'success') {
      const paid = await markWithdrawalPaid({
        txId: row._id,
        transferCode: transfer.transferCode ?? null,
        transferStatus: 'success',
        note: 'Legacy manual withdrawal paid automatically',
      });
      await TransactionModel.updateOne(
        { _id: row._id },
        { $set: { payoutMode: 'automatic' } },
      );
      await notifyPayoutOutcome({
        partnerId: row.partnerId,
        amountNgn: row.amount,
        reference: row.reference,
        outcome: 'paid',
        payoutMode: 'automatic',
        bank: row.bank,
        accountName: resolved.accountName,
      });
      result.action = paid ? 'paid' : 'already terminal';
      summary.push(result);
      continue;
    }

    if (['otp', 'failed', 'reversed'].includes(transferStatus)) {
      const reason = transferStatus === 'otp'
        ? 'Paystack requires transfer OTP — automatic payouts are not enabled on this account'
        : `Paystack transfer ${transferStatus}`;
      await refundWithdrawal({
        txId: row._id,
        reason,
        transferStatus,
        note: `Legacy manual withdrawal failed automatic payout: ${reason}`,
      });
      await TransactionModel.updateOne(
        { _id: row._id },
        { $set: { payoutMode: 'automatic' } },
      );
      await notifyPayoutOutcome({
        partnerId: row.partnerId,
        amountNgn: row.amount,
        reference: row.reference,
        outcome: 'refunded',
        payoutMode: 'automatic',
        reason,
        bank: row.bank,
        accountName: resolved.accountName,
      });
      result.action = `refunded — ${reason}`;
      summary.push(result);
      continue;
    }

    await TransactionModel.updateOne(
      { _id: row._id },
      {
        $set: {
          payoutMode: 'automatic',
          transferStatus,
          transferCode: transfer.transferCode ?? null,
        },
      },
    );
    await notifyPayoutOutcome({
      partnerId: row.partnerId,
      amountNgn: row.amount,
      reference: row.reference,
      outcome: 'pending',
      payoutMode: 'automatic',
      bank: row.bank,
      accountName: resolved.accountName,
    });
    result.action = `automatic transfer ${transferStatus}`;
    summary.push(result);
  } catch (error) {
    result.action = `error — ${error?.message ?? error}`;
    summary.push(result);
  }
}

console.log(JSON.stringify({
  database: mongoose.connection.name,
  mode: APPLY ? 'apply' : 'dry-run (set APPLY=1 to pay)',
  rows: summary,
}, null, 2));

await mongoose.connection.close(false);
