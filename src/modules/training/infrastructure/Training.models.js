import mongoose from 'mongoose';
import { TRAINING_MILESTONES, TRAINING_STATUSES } from '../domain/Training.domain.js';

const quizQuestionSchema = new mongoose.Schema(
  {
    q: { type: String, required: true, trim: true, maxlength: 500 },
    options: { type: [String], required: true },
    answer: { type: Number, required: true, min: 0, max: 5 },
  },
  { _id: false },
);

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    tagline: { type: String, default: '', trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    milestone: {
      type: String,
      enum: [...TRAINING_MILESTONES, null],
      default: null,
      index: true,
    },
    coverUrl: { type: String, default: null, trim: true, maxlength: 700 },
    status: {
      type: String,
      enum: TRAINING_STATUSES,
      default: 'draft',
      index: true,
    },
    sortOrder: { type: Number, min: 0, default: 0, index: true },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  },
  { timestamps: true, collection: 'training_courses' },
);

courseSchema.index({ status: 1, sortOrder: 1, createdAt: 1 });
courseSchema.index({ milestone: 1, status: 1 });
courseSchema.index({ title: 'text', tagline: 'text', description: 'text' });

const lessonSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TrainingCourse',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    summary: { type: String, default: '', trim: true, maxlength: 500 },
    body: { type: String, default: '', maxlength: 50000 },
    takeaways: { type: [String], default: [] },
    transcript: { type: String, default: '', maxlength: 30000 },
    youtubeId: { type: String, default: null, trim: true, maxlength: 11 },
    youtubeUrl: { type: String, default: null, trim: true, maxlength: 300 },
    thumbnailUrl: { type: String, default: null, trim: true, maxlength: 700 },
    durationSec: { type: Number, min: 0, max: 43200, default: 0 },
    quiz: { type: [quizQuestionSchema], default: [] },
    status: {
      type: String,
      enum: TRAINING_STATUSES,
      default: 'draft',
      index: true,
    },
    sortOrder: { type: Number, min: 0, default: 0, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  },
  { timestamps: true, collection: 'training_lessons' },
);

lessonSchema.index({ courseId: 1, status: 1, sortOrder: 1, createdAt: 1 });
lessonSchema.index({ courseId: 1, sortOrder: 1 });
lessonSchema.index({ title: 'text', summary: 'text', body: 'text' });

const progressWatchSchema = new mongoose.Schema(
  {
    percent: { type: Number, default: 0 },
    seconds: { type: Number, default: 0 },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const progressSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      required: true,
      index: true,
    },
    // Course/lesson ids stay strings so progress survives even if a course is
    // rebuilt or an id shape changes later.
    courseId: { type: String, required: true, index: true },
    completedLessons: { type: [String], default: [] },
    certificateAt: { type: Date, default: null },
    watch: { type: Map, of: progressWatchSchema, default: {} },
  },
  { timestamps: true, collection: 'training_progress' },
);

progressSchema.index({ partnerId: 1, courseId: 1 }, { unique: true });
progressSchema.index({ courseId: 1 });

export const TrainingCourseModel =
  mongoose.models.TrainingCourse
  ?? mongoose.model('TrainingCourse', courseSchema);

export const TrainingLessonModel =
  mongoose.models.TrainingLesson
  ?? mongoose.model('TrainingLesson', lessonSchema);

export const TrainingProgressModel =
  mongoose.models.TrainingProgress
  ?? mongoose.model('TrainingProgress', progressSchema);
