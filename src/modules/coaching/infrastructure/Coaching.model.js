import mongoose from 'mongoose';

const noteSchema = new mongoose.Schema(
  {
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    coachId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    body: { type: String, required: true, maxlength: 2000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
noteSchema.index({ memberId: 1, createdAt: -1 });

export const CoachingNoteModel = mongoose.models.CoachingNote ?? mongoose.model('CoachingNote', noteSchema);
