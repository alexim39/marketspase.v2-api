import mongoose from 'mongoose';

const quizSchema = new mongoose.Schema(
  {
    courseId: { type: String, required: true, index: true },
    lessonId: { type: String, required: true, index: true },
    quiz: {
      type: [
        {
          q: { type: String, required: true, maxlength: 500 },
          options: { type: [String], required: true },
          answer: { type: Number, required: true, min: 0, max: 10 },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);
quizSchema.index({ courseId: 1, lessonId: 1 }, { unique: true });

export const TrainingQuizModel = mongoose.models.TrainingQuiz ?? mongoose.model('TrainingQuiz', quizSchema);
