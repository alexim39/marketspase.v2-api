import mongoose from 'mongoose';

/**
 * Deposit intent — one row per wallet top-up attempt. `reference` is the
 * idempotency key shared with Opay (their 02004 + our callback dedupe both
 * key off it). `method` splits gateway intents (`opay`) from human-verified
 * manual claims (`manual`: `claim` details + exactly-once admin decision).
 * Rows never delete: abandoned attempts are history.
 */
const depositSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    amountNgn: { type: Number, required: true, min: 0 },
    amountKobo: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['opay', 'manual'], default: 'opay', index: true },
    status: {
      type: String,
      enum: ['created', 'pending', 'success', 'failed', 'closed', 'awaiting-review', 'approved', 'rejected'],
      default: 'created',
      index: true,
    },
    orderNo: { type: String, default: null },
    creditedAt: { type: Date, default: null },
    lastCallback: { type: mongoose.Schema.Types.Mixed, default: null },
    // Manual-claim evidence (details only v1) + the exactly-once decision.
    claim: {
      destinationAccount: { type: String, default: null },
      senderName: { type: String, default: null },
      senderAccount: { type: String, default: null },
      paidAt: { type: Date, default: null },
      bankReference: { type: String, default: null },
      note: { type: String, default: null },
    },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
  },
  { timestamps: true },
);
depositSchema.index({ partnerId: 1, createdAt: -1 });

export const DepositIntentModel = mongoose.models['Deposit-intent']
  ?? mongoose.model('Deposit-intent', depositSchema);
