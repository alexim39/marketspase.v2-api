import mongoose from 'mongoose';
import { TUTORIAL_AREAS } from '../domain/Tutorial.youtube.js';

const tutorialSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    youtubeId: { type: String, required: true, maxlength: 11, index: true },
    url: { type: String, default: '', maxlength: 300 },
    area: { type: String, enum: TUTORIAL_AREAS, default: 'Start', index: true },
    order: { type: Number, default: 0, min: 0, max: 10000 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  },
  { timestamps: true },
);
tutorialSchema.index({ active: 1, area: 1, order: 1 });

export const TutorialModel =
  mongoose.models.Tutorial ?? mongoose.model('Tutorial', tutorialSchema);
