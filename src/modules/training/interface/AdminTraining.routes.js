import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { recordAudit } from '../../audit/index.js';
import { TRAINING_MILESTONES, TRAINING_STATUSES } from '../domain/Training.domain.js';
import {
  ArchiveCourseUseCase,
  CreateCourseUseCase,
  CreateLessonUseCase,
  DeleteLessonUseCase,
  GetAdminCourseUseCase,
  ListAdminCoursesUseCase,
  ReorderCoursesUseCase,
  ReorderLessonsUseCase,
  UpdateCourseUseCase,
  UpdateLessonUseCase,
} from '../application/Training.admin.usecases.js';
import { MongoTrainingStore } from '../infrastructure/Training.mongo.repository.js';

const idLike = z.string().trim().min(1).max(64);
const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const CourseParam = z.object({ courseId: idLike });
const LessonParam = z.object({ courseId: idLike, lessonId: idLike });
const StatusSchema = z.enum(TRAINING_STATUSES);
const MilestoneSchema = z.preprocess(
  (value) => (value === '' || value === 'none' ? null : value),
  z.enum(TRAINING_MILESTONES).nullable().optional(),
);

const QuizQuestionSchema = z.object({
  q: z.string().trim().min(3).max(500),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
  answer: z.number().int().min(0).max(5),
}).refine((question) => question.answer < question.options.length, {
  message: 'Answer index out of range',
  path: ['answer'],
});

const QuizSchema = z.array(QuizQuestionSchema).max(15);

const CourseSchema = z.object({
  title: z.string().trim().min(3).max(120),
  tagline: z.string().trim().max(200).optional().default(''),
  description: z.string().max(5000).optional().default(''),
  milestone: MilestoneSchema,
  coverUrl: z.string().trim().max(700).nullable().optional(),
  status: StatusSchema.optional(),
});

const CoursePatchSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  tagline: z.string().trim().max(200).optional(),
  description: z.string().max(5000).optional(),
  milestone: MilestoneSchema,
  coverUrl: z.string().trim().max(700).nullable().optional(),
  status: StatusSchema.optional(),
}).refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

const LessonSchema = z.object({
  title: z.string().trim().min(3).max(140),
  summary: z.string().max(500).optional().default(''),
  body: z.string().max(50000).optional().default(''),
  takeaways: z.array(z.string().trim().min(1).max(240)).max(12).optional().default([]),
  transcript: z.string().max(30000).optional().default(''),
  youtubeUrl: z.string().trim().max(300).nullable().optional(),
  durationSec: z.coerce.number().int().min(0).max(43200).optional().default(0),
  quiz: QuizSchema.optional().default([]),
  status: StatusSchema.optional(),
});

const LessonPatchSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  summary: z.string().max(500).optional(),
  body: z.string().max(50000).optional(),
  takeaways: z.array(z.string().trim().min(1).max(240)).max(12).optional(),
  transcript: z.string().max(30000).optional(),
  youtubeUrl: z.string().trim().max(300).nullable().optional(),
  durationSec: z.preprocess(
    (value) => (value === '' || value === null ? 0 : value),
    z.coerce.number().int().min(0).max(43200).optional(),
  ),
  quiz: QuizSchema.optional(),
  status: StatusSchema.optional(),
}).refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

const OrderSchema = z.object({
  ids: z.array(objectId).min(1).max(500),
});

/** Admin Training Studio — course/lesson authoring and publishing. */
export const buildAdminTrainingRouter = (deps = {}) => {
  const training = deps.training ?? new MongoTrainingStore();
  const audit = deps.audit ?? recordAudit;

  const list = new ListAdminCoursesUseCase({ training });
  const detail = new GetAdminCourseUseCase({ training });
  const createCourse = new CreateCourseUseCase({ training });
  const updateCourse = new UpdateCourseUseCase({ training });
  const archiveCourse = new ArchiveCourseUseCase({ training });
  const reorderCourses = new ReorderCoursesUseCase({ training });
  const createLesson = new CreateLessonUseCase({ training });
  const updateLesson = new UpdateLessonUseCase({ training });
  const deleteLesson = new DeleteLessonUseCase({ training });
  const reorderLessons = new ReorderLessonsUseCase({ training });

  const router = express.Router();
  router.use(deps.auth ?? requireAuth, deps.admin ?? requireRole('admin'));

  router.get('/courses', asyncHandler(async (_req, res) => {
    const data = await list.execute();
    return sendSuccess(res, { message: 'Training courses retrieved successfully', data });
  }));

  router.post('/courses', validate({ body: CourseSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await createCourse.execute({ adminId: req.auth?.partnerId, input: body });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'training.course.create',
      targetType: 'course',
      targetId: data.id,
      detail: { title: data.title, milestone: data.milestone, status: data.status },
    });
    return sendSuccess(res, { statusCode: 201, message: 'Course created as a draft', data });
  }));

  router.put('/courses/order', validate({ body: OrderSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await reorderCourses.execute({ ids: body.ids });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'training.course.order',
      targetType: 'course',
      targetId: 'order',
      detail: { count: data.length },
    });
    return sendSuccess(res, { message: 'Course order updated', data });
  }));

  router.get('/courses/:courseId', validate({ params: CourseParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await detail.execute({ courseId: params.courseId });
    return sendSuccess(res, { message: 'Course retrieved successfully', data });
  }));

  router.patch('/courses/:courseId', validate({ params: CourseParam, body: CoursePatchSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await updateCourse.execute({
      courseId: params.courseId,
      adminId: req.auth?.partnerId,
      input: body,
    });
    void audit({
      actorId: req.auth?.partnerId,
      action: body.status ? 'training.course.status' : 'training.course.update',
      targetType: 'course',
      targetId: params.courseId,
      detail: {
        status: data.status,
        milestone: data.milestone,
        ...(body.milestone !== undefined ? { milestoneChanged: true } : {}),
      },
    });
    return sendSuccess(res, { message: 'Course updated successfully', data });
  }));

  router.patch('/courses/:courseId/status', validate({ params: CourseParam, body: z.object({ status: StatusSchema }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await updateCourse.execute({
      courseId: params.courseId,
      adminId: req.auth?.partnerId,
      input: { status: body.status },
    });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'training.course.status',
      targetType: 'course',
      targetId: params.courseId,
      detail: { status: data.status },
    });
    return sendSuccess(res, { message: `Course marked ${data.status}`, data });
  }));

  router.delete('/courses/:courseId', validate({ params: CourseParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await archiveCourse.execute({ courseId: params.courseId, adminId: req.auth?.partnerId });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'training.course.archive',
      targetType: 'course',
      targetId: params.courseId,
      detail: { title: data.title },
    });
    return sendSuccess(res, { message: 'Course archived', data });
  }));

  router.post('/courses/:courseId/lessons', validate({ params: CourseParam, body: LessonSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await createLesson.execute({
      courseId: params.courseId,
      adminId: req.auth?.partnerId,
      input: body,
    });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'training.lesson.create',
      targetType: 'lesson',
      targetId: data.id,
      detail: { courseId: params.courseId, title: data.title, status: data.status },
    });
    return sendSuccess(res, { statusCode: 201, message: 'Lesson created', data });
  }));

  router.put('/courses/:courseId/lessons/order', validate({ params: CourseParam, body: OrderSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await reorderLessons.execute({ courseId: params.courseId, ids: body.ids });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'training.lesson.order',
      targetType: 'course',
      targetId: params.courseId,
      detail: { count: data.length },
    });
    return sendSuccess(res, { message: 'Lesson order updated', data });
  }));

  router.patch('/courses/:courseId/lessons/:lessonId', validate({ params: LessonParam, body: LessonPatchSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await updateLesson.execute({
      courseId: params.courseId,
      lessonId: params.lessonId,
      adminId: req.auth?.partnerId,
      input: body,
    });
    void audit({
      actorId: req.auth?.partnerId,
      action: body.status ? 'training.lesson.status' : 'training.lesson.update',
      targetType: 'lesson',
      targetId: params.lessonId,
      detail: { courseId: params.courseId, status: data.status },
    });
    return sendSuccess(res, { message: 'Lesson updated successfully', data });
  }));

  router.delete('/courses/:courseId/lessons/:lessonId', validate({ params: LessonParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await deleteLesson.execute({ courseId: params.courseId, lessonId: params.lessonId });
    void audit({
      actorId: req.auth?.partnerId,
      action: 'training.lesson.delete',
      targetType: 'lesson',
      targetId: params.lessonId,
      detail: { courseId: params.courseId },
    });
    return sendSuccess(res, { message: 'Lesson deleted', data });
  }));

  return router;
};

export default buildAdminTrainingRouter();
