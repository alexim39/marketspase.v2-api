import mongoose from 'mongoose';
import { KIT_AREAS } from '../domain/Kit.js';

const slideSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },
    imageUrl: { type: String, default: '', maxlength: 500 },
    note: { type: String, default: '', maxlength: 1000 },
  },
  { _id: false },
);

const kitSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    area: { type: String, enum: KIT_AREAS, default: 'Opportunity', index: true },
    // Deck source: hand-built `slides` or an uploaded PDF (`fileUrl`).
    // Old rows carry slides only and read back as manual.
    source: { type: String, enum: ['manual', 'file'], default: 'manual' },
    fileUrl: { type: String, default: '', maxlength: 1000 },
    slides: { type: [slideSchema], default: [] },
    durationMin: { type: Number, default: 10, min: 1, max: 120 },
    order: { type: Number, default: 0, min: 0, max: 10000 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  },
  { timestamps: true },
);
kitSchema.index({ active: 1, area: 1, order: 1 });

export const KitModel =
  mongoose.models.Kit ?? mongoose.model('Kit', kitSchema);
