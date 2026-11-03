// models/transaction.js
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'partner',
    required: true,
  },
  amount: Number,
  reference: String,
  status: String,
  paymentMethod: String,
  transactionType: String,
  // Withdrawal destination — stored on the record (previously email-only,
  // leaving the admin queue blind about where to pay). Absent on legacy rows.
  bank: { type: String, default: null },
  accountNumber: { type: String, default: null },
  accountName: { type: String, default: null },
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

export const TransactionModel = mongoose.model('Transaction', transactionSchema);
