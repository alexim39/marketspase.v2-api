import mongoose from 'mongoose';

/**
 * A partner's saved payout destination.
 *
 * Kept out of the general partner profile so payout PII is never returned by
 * profile, directory or public-page reads. The account number is sealed at rest
 * by the repository; only the owner-facing billing endpoint opens it.
 */
const savedPayoutAccountSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      required: true,
      unique: true,
      index: true,
    },
    bankCode: { type: String, required: true, trim: true, maxlength: 20 },
    bankName: { type: String, required: true, trim: true, maxlength: 120 },
    accountName: { type: String, required: true, trim: true, maxlength: 200 },
    accountNumberSealed: { type: String, required: true },
    accountLast4: { type: String, required: true, match: /^\d{4}$/ },
  },
  { timestamps: true, collection: 'saved_payout_accounts' },
);

savedPayoutAccountSchema.index({ partnerId: 1 }, { unique: true });

export const SavedPayoutAccountModel =
  mongoose.models.SavedPayoutAccount
  ?? mongoose.model('SavedPayoutAccount', savedPayoutAccountSchema);
