import mongoose from 'mongoose';

/**
 * One row per member × tutorial.
 *
 * The unique index is the guard that makes view counts one-per-partner,
 * across refreshes, devices and concurrent requests. Rows are intentionally
 * never deleted so a video cannot be re-counted by the same member.
 */
const tutorialViewSchema = new mongoose.Schema(
  {
    tutorialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tutorial', required: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

tutorialViewSchema.index({ tutorialId: 1, partnerId: 1 }, { unique: true });

export const TutorialViewModel =
  mongoose.models.TutorialView ?? mongoose.model('TutorialView', tutorialViewSchema);
