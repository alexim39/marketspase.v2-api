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

const seedStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'BonusCampaign', default: null },
  },
  { timestamps: true, collection: 'bonus_seed_state' },
);

export const BonusCampaignModel =
  mongoose.models.BonusCampaign ?? mongoose.model('BonusCampaign', campaignSchema);
export const BonusClaimModel =
  mongoose.models.BonusClaim ?? mongoose.model('BonusClaim', claimSchema);
export const BonusSeedStateModel =
  mongoose.models.BonusSeedState ?? mongoose.model('BonusSeedState', seedStateSchema);

const WELCOME_SEED_KEY = 'welcome_bonus';

/**
 * Seed the initial N2500 welcome bonus exactly once.
 *
 * The old behavior looked only for an active campaign, so disabling the
 * welcome bonus on every API restart created a new copy. A persistent seed
 * marker now records the one campaign we created; disabled campaigns stay
 * disabled, and deleting the seeded campaign does not resurrect it.
 */
export const ensureSeedBonus = async (now = new Date()) => {
  const marker = await BonusSeedStateModel.findOne({ key: WELCOME_SEED_KEY }).lean().catch(() => null);
  if (marker) {
    if (!marker.campaignId) return { seeded: false, id: null, retired: true };
    const existing = await BonusCampaignModel.findById(marker.campaignId).lean().catch(() => null);
    if (!existing) return { seeded: false, id: null, retired: true };
    if (existing.eligibleAfter) {
      await BonusCampaignModel.updateOne({ _id: existing._id }, { $set: { eligibleAfter: null } }).catch(() => null);
    }
    return { seeded: false, id: String(existing._id) };
  }

  // Adopt an existing welcome campaign (including a disabled one) instead of
  // creating a duplicate, then remember it for all future boots.
  const existing = await BonusCampaignModel.findOne({ title: /^welcome bonus$/i })
    .sort({ createdAt: 1 })
    .lean()
    .catch(() => null);
  if (existing) {
    await BonusSeedStateModel.updateOne(
      { key: WELCOME_SEED_KEY },
      { $set: { campaignId: existing._id } },
      { upsert: true },
    ).catch(() => null);
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
    return { seeded: false, id: null };
  }
  await BonusSeedStateModel.updateOne(
    { key: WELCOME_SEED_KEY },
    { $set: { campaignId: doc._id } },
    { upsert: true },
  ).catch(() => null);
  return { seeded: true, id: String(doc._id) };
};
