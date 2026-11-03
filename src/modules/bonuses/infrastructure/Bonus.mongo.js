import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    message: { type: String, default: '', maxlength: 500 },
    amountNgn: { type: Number, required: true, min: 1, max: 1000000 },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true },
    eligibleAfter: { type: Date, default: null },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  },
  { timestamps: true },
);

const claimSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'BonusCampaign', required: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    amountNgn: { type: Number, required: true },
    reference: { type: String, required: true, unique: true },
    transactionId: { type: String, default: null },
  },
  { timestamps: true },
);
claimSchema.index({ campaignId: 1, partnerId: 1 }, { unique: true });

export const BonusCampaignModel =
  mongoose.models.BonusCampaign ?? mongoose.model('BonusCampaign', campaignSchema);
export const BonusClaimModel =
  mongoose.models.BonusClaim ?? mongoose.model('BonusClaim', claimSchema);

/** Seed the initial N2500 welcome bonus (idempotent — one active welcome campaign).
 * Open to every member, old and new: no eligibleAfter gate. Existing seeds
 * from before this fix get their gate lifted on boot. */
export const ensureSeedBonus = async (now = new Date()) => {
  const existing = await BonusCampaignModel.findOne({ status: 'active' }).lean().catch(() => null);
  if (existing) {
    if (existing.eligibleAfter) {
      await BonusCampaignModel.updateOne({ _id: existing._id }, { $set: { eligibleAfter: null } }).catch(() => null);
    }
    return { seeded: false, id: String(existing._id) };
  }
  const doc = await BonusCampaignModel.create({
    title: 'Welcome bonus',
    message: 'Claim your N2500 welcome bonus into your wallet — use it to claim prospects and grow your business.',
    amountNgn: 2500,
    status: 'active',
    eligibleAfter: null,
    startsAt: now,
  }).catch(() => null);
  if (!doc) {
    const retry = await BonusCampaignModel.findOne({ status: 'active' }).lean().catch(() => null);
    return { seeded: false, id: retry ? String(retry._id) : null };
  }
  return { seeded: true, id: String(doc._id) };
};
