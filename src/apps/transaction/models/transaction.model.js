// models/transaction.js
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'partner',
    required: true,
  },
  amount: Number,
  // Immutable wallet snapshot for disputes and reconciliation.
  balanceBefore: { type: Number, default: null },
  balanceAfter: { type: Number, default: null },
  reference: String,
  status: String,
  paymentMethod: String,
  transactionType: String,
  // Withdrawal destination — stored on the record (previously email-only,
  // leaving the admin queue blind about where to pay). Absent on legacy rows.
  bank: { type: String, default: null },
  bankCode: { type: String, default: null },
  accountNumber: { type: String, default: null },
  accountLast4: { type: String, default: null },
  accountName: { type: String, default: null },
  // Automatic Paystack payout state. Manual/legacy rows leave these null.
  payoutMode: { type: String, enum: ['automatic', 'manual'], default: undefined },
  transferRecipientCode: { type: String, default: null },
  transferCode: { type: String, default: null },
  transferStatus: { type: String, default: null },
  payoutInitiatedAt: { type: Date, default: null },
  payoutCompletedAt: { type: Date, default: null },
  payoutFailureReason: { type: String, default: null },
  // Admin decision audit (withdrawals + any approved flow).
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
  decidedAt: { type: Date, default: null },
  decisionNote: { type: String, default: null },
  date: {
    type: Date,
    default: Date.now,
  },
  // Other transaction details...
});

// Reconcile job lookup: Pending automatic withdrawals by initiation time.
transactionSchema.index({ paymentMethod: 1, status: 1, payoutMode: 1, payoutInitiatedAt: 1 });
transactionSchema.index({ partnerId: 1, date: -1 });
transactionSchema.index({ partnerId: 1, createdAt: -1 });
transactionSchema.index({ reference: 1 });

export const TransactionModel = mongoose.model('Transaction', transactionSchema);
