import mongoose from 'mongoose';

const growthCampaignSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    category: { type: String, default: '', trim: true },
    brief: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['Pending', 'Active', 'Paused', 'Ended', 'Cancelled'],
      default: 'Pending',
      index: true,
    },
    budget: {
      total: { type: Number, required: true, min: 1 },
      spent: { type: Number, default: 0, min: 0 },
      refunded: { type: Number, default: 0, min: 0 },
    },
    flight: {
      startAt: { type: Date, required: true },
      endAt: { type: Date, default: null },
    },
    capacity: {
      total: { type: Number, default: 2, min: 2, max: 20 },
      allocated: { type: Number, default: 0, min: 0 },
      maxPerWeek: { type: Number, default: 2, min: 1, max: 10 },
    },
    targetAudience: {
      states: { type: [String], default: [] },
      ageRange: { type: String, default: 'All', trim: true },
      gender: { type: String, default: 'All', trim: true },
    },
    supportQuality: { type: Number, default: 60, min: 0, max: 100 },
    trackingCode: { type: String, required: true, unique: true, trim: true },
    fundingReference: { type: String, required: true, trim: true },
    adminNote: { type: String, default: null, trim: true },
    activatedAt: { type: Date, default: null },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    pausedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', default: null },
    refundedAt: { type: Date, default: null },
    refundReason: { type: String, default: null, trim: true },
    lastAllocatedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'growth_campaigns' },
);

const partnerAllocationSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      unique: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'partner',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GrowthCampaign',
      required: true,
      index: true,
    },
    queueEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ActivationQueueEntry',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'ended', 'reversed'],
      default: 'active',
      index: true,
    },
    score: {
      fairness: { type: Number, default: 0 },
      contribution: { type: Number, default: 0 },
      fit: { type: Number, default: 0 },
      capacitySupport: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    components: {
      waitDays: { type: Number, default: 0 },
      budgetTotal: { type: Number, default: 0 },
      supportQuality: { type: Number, default: 0 },
      capacityRemaining: { type: Number, default: 0 },
      partnerState: { type: String, default: '' },
    },
    explanation: { type: [String], default: [] },
    allocatedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'partner_allocations' },
);

growthCampaignSchema.index({ ownerId: 1, createdAt: -1 });
growthCampaignSchema.index({ status: 1, createdAt: 1 });
growthCampaignSchema.index({ status: 1, 'flight.startAt': 1 });
partnerAllocationSchema.index({ campaignId: 1, status: 1 });
partnerAllocationSchema.index({ campaignId: 1, allocatedAt: -1 });
partnerAllocationSchema.index({ ownerId: 1, allocatedAt: -1 });

export const GrowthCampaignModel =
  mongoose.models.GrowthCampaign
  || mongoose.model('GrowthCampaign', growthCampaignSchema);

export const PartnerAllocationModel =
  mongoose.models.PartnerAllocation
  || mongoose.model('PartnerAllocation', partnerAllocationSchema);
