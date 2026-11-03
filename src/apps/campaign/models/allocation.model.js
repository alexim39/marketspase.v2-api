import mongoose from 'mongoose';

/**
 * Campaign allocation ledger — one row per system-matched lead.
 * This ledger IS the per-campaign allocation metric source (delivered,
 * tiers, spend) and the audit trail (who got what, when, for how much).
 * Status lifecycle: assigned → accepted (partner works them in
 * personal-list/pipeline) → converted; reported-bad → replaced|delivered.
 */
const allocationSchema = mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'partner', required: true, index: true },
    // Pool survey row consumed by this allocation (username moved business → partner).
    poolSurveyId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    // Prospect created when the partner accepts the row into follow-ups.
    prospectId: { type: mongoose.Schema.Types.ObjectId, default: null },
    tier: { type: Number, enum: [1, 2, 3], required: true },
    score: { type: Number, default: 0 },
    costDebited: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['assigned', 'accepted', 'converted', 'reported-bad', 'replaced'],
      default: 'assigned',
      index: true,
    },
    reportReason: { type: String, default: '' },
    decidedNote: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

allocationSchema.index({ campaignId: 1, createdAt: -1 });
allocationSchema.index({ campaignId: 1, status: 1 });
allocationSchema.index({ poolSurveyId: 1 }, { unique: true });

export const CampaignAllocationModel =
  mongoose.models.CampaignAllocation ?? mongoose.model('CampaignAllocation', allocationSchema);
