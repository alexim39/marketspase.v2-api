import mongoose from 'mongoose';

/**
 * Per-lesson media override — same pattern as quiz overrides: the code
 * catalog stays the fallback, an admin-saved row wins field-by-field.
 * URLs only (https or site-relative /courses/… path); binaries live in
 * public/ or Cloudinary, never in Mongo and never through this API.
 * body/takeaways let admins edit the study text without a deploy.
 */
const mediaSchema = new mongoose.Schema(
  {
    courseId: { type: String, required: true, index: true },
    lessonId: { type: String, required: true, index: true },
    videoUrl: { type: String, default: null, maxlength: 500 },
    posterUrl: { type: String, default: null, maxlength: 500 },
    captionsUrl: { type: String, default: null, maxlength: 500 },
    transcript: { type: String, default: null, maxlength: 8000 },
    durationSec: { type: Number, default: null, min: 0, max: 86400 },
    body: { type: String, default: null, maxlength: 20000 },
    takeaways: { type: [String], default: undefined },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);
mediaSchema.index({ courseId: 1, lessonId: 1 }, { unique: true });

export const TrainingMediaModel = mongoose.models.TrainingMedia
  ?? mongoose.model('TrainingMedia', mediaSchema);
