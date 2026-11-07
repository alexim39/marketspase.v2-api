import mongoose from 'mongoose';

/**
 * Zero-result search log. Kept for 90 days so product/content teams can see
 * what users searched for but the catalogue does not have yet.
 */
const searchMissSchema = new mongoose.Schema(
  {
    q: { type: String, required: true, index: true },
    partnerId: { type: String, default: null, index: true },
    groups: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
  },
  { timestamps: false },
);
searchMissSchema.index({ createdAt: -1 });

export const SearchMissModel = mongoose.models.SearchMiss
  ?? mongoose.model('SearchMiss', searchMissSchema);
