import mongoose from 'mongoose';

/**
 * A partner's saved payout destinations (up to five).
 *
 * Kept out of the general partner profile so payout PII is never returned by
 * profile, directory or public-page reads. The account number is sealed at rest
 * by the repository; only the owner-facing billing endpoints open it.
 */
const savedPayoutAccountSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      required: true,
      index: true,
    },
    bankCode: { type: String, required: true, trim: true, maxlength: 20 },
    bankName: { type: String, required: true, trim: true, maxlength: 120 },
    accountName: { type: String, required: true, trim: true, maxlength: 200 },
    accountNumberSealed: { type: String, required: true },
    accountLast4: { type: String, required: true, match: /^\d{4}$/ },
    /**
     * Deterministic HMAC used to stop the same account being saved twice.
     * Nullable for rows created before multi-account support; the migration
     * backfills it and the partial index ignores legacy nulls.
     */
    accountNumberHash: { type: String, default: null, trim: true },
  },
  { timestamps: true, collection: 'saved_payout_accounts' },
);

savedPayoutAccountSchema.index({ partnerId: 1, updatedAt: -1 });
savedPayoutAccountSchema.index(
  { partnerId: 1, bankCode: 1, accountNumberHash: 1 },
  {
    unique: true,
    partialFilterExpression: { accountNumberHash: { $type: 'string' } },
    name: 'partner_bank_account_unique',
  },
);

export const SavedPayoutAccountModel =
  mongoose.models.SavedPayoutAccount
  ?? mongoose.model('SavedPayoutAccount', savedPayoutAccountSchema);
