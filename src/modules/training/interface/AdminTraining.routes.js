import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { MongoTrainingStore } from '../../training/infrastructure/Training.mongo.repository.js';
import { recordAudit } from '../../audit/index.js';
import { COURSES } from '../../training/domain/Training.catalog.js';

const slug = z.string().trim().min(1).max(64);

const QuizQuestionSchema = z.object({
  q: z.string().trim().min(3).max(500),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
  answer: z.number().int().min(0),
}).refine((o) => o.answer < o.options.length, { message: 'Answer index out of range', path: ['answer'] });

const QuizSchema = z.array(QuizQuestionSchema).min(1).max(15);

// Media override values: https URLs (e.g. Cloudinary) or site-relative
// paths (e.g. /courses/ipo/lesson.mp4 for public/ files). Binaries never
// flow through this API — hosting stays wherever the team puts the file.
const MediaUrl = z.string().trim().max(500).refine(
  (v) => v === '' || /^https?:\/\/.+/.test(v) || /^\/[A-Za-z0-9_\-./]+$/.test(v),
  { message: 'Must be an https URL or a site path like /courses/ipo/lesson.mp4' },
);

export const MediaSchema = z.object({
  videoUrl: MediaUrl.nullable().optional(),
  posterUrl: MediaUrl.nullable().optional(),
  captionsUrl: MediaUrl.nullable().optional(),
  transcript: z.string().trim().max(8000).nullable().optional(),
  durationSec: z.number().int().min(0).max(86400).nullable().optional(),
  body: z.string().trim().max(20000).nullable().optional(),
  takeaways: z.array(z.string().trim().min(1).max(200)).max(10).nullable().optional(),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildAdminTrainingRouter = (deps = {}) => {
  const training = deps.training ?? new MongoTrainingStore();

  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/quizzes', asyncHandler(async (_req, res) => {
    const data = await training.listQuizzes();
    res.status(200).json({ message: 'Quizzes retrieved successfully', data, success: true });
  }));

  router.get('/catalog', asyncHandler(async (_req, res) => {
    const media = await training.listMedia?.().catch(() => []) ?? [];
    const byLesson = new Map(media.map((m) => [`${m.courseId}:${m.lessonId}`, m]));
    const data = COURSES.map((c) => ({
      id: c.id,
      title: c.title,
      lessons: c.lessons.map((l) => {
        const override = byLesson.get(`${c.id}:${l.id}`);
        return {
          id: l.id,
          title: l.title,
          quizCount: l.quiz?.length ?? 0,
          mediaOverridden: !!override,
          // Effective values learners see (override wins, catalog fallback).
          videoUrl: override?.videoUrl || l.videoUrl || null,
          posterUrl: override?.posterUrl || l.posterUrl || null,
          captionsUrl: override?.captionsUrl || l.captionsUrl || null,
          hasTranscript: !!((override?.transcript || l.transcript) ?? null),
          durationSec: override?.durationSec ?? l.durationSec ?? null,
          body: override?.body || l.body || '',
          takeaways: (Array.isArray(override?.takeaways) && override.takeaways.length > 0)
            ? override.takeaways
            : (l.takeaways ?? []),
          bodyOverridden: !!(override?.body),
        };
      }),
    }));
    res.status(200).json({ message: 'Catalog retrieved successfully', data, success: true });
  }));

  router.put('/courses/:courseId/lessons/:lessonId/quiz', validate({ params: z.object({ courseId: slug, lessonId: slug }), body: QuizSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    // Validate lesson exists (catalog is the source of truth for ids).
    const course = COURSES.find((c) => c.id === params.courseId);
    if (!course) return res.status(404).json({ message: 'Unknown course', success: false });
    if (!course.lessons.some((l) => l.id === params.lessonId)) {
      return res.status(404).json({ message: 'Unknown lesson', success: false });
    }
    const data = await training.upsertQuiz(params.courseId, params.lessonId, body);
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'training.quiz.save',
      targetType: 'lesson', targetId: `${params.courseId}:${params.lessonId}`,
      detail: { questions: body.length },
    });
    res.status(200).json({ message: 'Quiz saved successfully', data, success: true });
  }));

  router.get('/media', asyncHandler(async (_req, res) => {
    const data = await training.listMedia();
    res.status(200).json({ message: 'Media overrides retrieved successfully', data, success: true });
  }));

  router.put('/courses/:courseId/lessons/:lessonId/media', validate({ params: z.object({ courseId: slug, lessonId: slug }), body: MediaSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const course = COURSES.find((c) => c.id === params.courseId);
    if (!course) return res.status(404).json({ message: 'Unknown course', success: false });
    if (!course.lessons.some((l) => l.id === params.lessonId)) {
      return res.status(404).json({ message: 'Unknown lesson', success: false });
    }
    const data = await training.upsertMedia(params.courseId, params.lessonId, body, req.auth?.partnerId);
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'training.media.save',
      targetType: 'lesson', targetId: `${params.courseId}:${params.lessonId}`,
      detail: { videoUrl: body.videoUrl ?? null },
    });
    res.status(200).json({ message: 'Media saved successfully', data, success: true });
  }));

  router.delete('/courses/:courseId/lessons/:lessonId/media', validate({ params: z.object({ courseId: slug, lessonId: slug }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const course = COURSES.find((c) => c.id === params.courseId);
    if (!course) return res.status(404).json({ message: 'Unknown course', success: false });
    if (!course.lessons.some((l) => l.id === params.lessonId)) {
      return res.status(404).json({ message: 'Unknown lesson', success: false });
    }
    const data = await training.deleteMedia(params.courseId, params.lessonId);
    if (data?.reverted) {
      void recordAudit({
        actorId: req.auth?.partnerId, action: 'training.media.revert',
        targetType: 'lesson', targetId: `${params.courseId}:${params.lessonId}`,
      });
    }
    res.status(200).json({ message: 'Media reverted to catalog', data, success: true });
  }));

  return router;
};

export default buildAdminTrainingRouter();
