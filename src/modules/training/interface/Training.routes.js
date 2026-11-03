import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  CompleteLessonUseCase, GetCourseUseCase, ListCoursesUseCase, MyCertificatesUseCase,
  NudgeMemberUseCase, RecordWatchUseCase, TeamComplianceUseCase, TeamMemberDetailUseCase,
} from '../application/Training.usecases.js';
import { NotifyUseCase } from '../../notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { ListPathsUseCase } from '../application/Training.paths.usecase.js';
import { ReadinessUseCase } from '../application/Training.readiness.usecase.js';
import { MongoTrainingStore } from '../infrastructure/Training.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { RecognitionUseCases } from '../../community/application/Community.usecases.js';
import { MongoCommunityStore } from '../../community/infrastructure/Community.mongo.repository.js';

const slug = z.string().trim().min(1).max(64);
const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const CourseParam = z.object({ courseId: slug });
const LessonParam = z.object({ courseId: slug, lessonId: slug });
const MemberParam = z.object({ partnerId: objectId });

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildTrainingRouter = (deps = {}) => {
  const training = deps.training ?? new MongoTrainingStore();
  const progress = deps.progress ?? new MongoProgressionStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const recognition = deps.recognition
    ?? new RecognitionUseCases({ community: deps.community ?? new MongoCommunityStore() });

  const list = new ListCoursesUseCase({ training });
  const detail = new GetCourseUseCase({ training });
  const complete = new CompleteLessonUseCase({ training, progress, recognition, network });
  const watch = new RecordWatchUseCase({ training });
  const compliance = new TeamComplianceUseCase({ training, network });
  const notifyStore = deps.stored ?? new MongoStoredNotificationStore();
  const memberDetail = new TeamMemberDetailUseCase({ training, network });
  const nudge = new NudgeMemberUseCase({
    training,
    network,
    stored: notifyStore,
    notify: deps.notify ?? new NotifyUseCase({ stored: notifyStore }),
    detail: memberDetail,
  });
  const certs = new MyCertificatesUseCase({ training });
  const paths = new ListPathsUseCase({ progress: deps.progress ?? progress, training });
  const readiness = new ReadinessUseCase({ progression: progress });

  const router = express.Router();
  router.use(requireAuth);

  router.get('/paths', asyncHandler(async (req, res) => {
    const data = await paths.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Learning paths retrieved successfully', data, success: true });
  }));

  router.get('/readiness', asyncHandler(async (req, res) => {
    const data = await readiness.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Promotion readiness retrieved successfully', data, success: true });
  }));

  router.get('/courses', asyncHandler(async (req, res) => {
    const data = await list.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Courses retrieved successfully', data, success: true });
  }));

  router.get('/courses/:courseId', validate({ params: CourseParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await detail.execute({ partnerId: req.auth?.partnerId, courseId: params.courseId });
    res.status(200).json({ message: 'Course retrieved successfully', data, success: true });
  }));

  router.post('/courses/:courseId/lessons/:lessonId/complete', validate({ params: LessonParam, body: z.object({ answers: z.array(z.number().int().min(0).max(10)).optional() }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await complete.execute({ partnerId: req.auth?.partnerId, courseId: params.courseId, lessonId: params.lessonId, answers: body.answers });
    res.status(200).json({ message: 'Lesson completed successfully', data, success: true });
  }));

  router.post('/courses/:courseId/lessons/:lessonId/watch', validate({ params: LessonParam, body: z.object({ percent: z.number().min(0).max(100), seconds: z.number().int().min(0).max(86400).optional().default(0) }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await watch.execute({ partnerId: req.auth?.partnerId, courseId: params.courseId, lessonId: params.lessonId, percent: body.percent, seconds: body.seconds ?? 0 });
    res.status(200).json({ message: 'Watch progress recorded', data, success: true });
  }));

  router.get('/team/compliance', asyncHandler(async (req, res) => {
    const data = await compliance.execute({ requesterId: req.auth?.partnerId, limit: req.query?.limit });
    res.status(200).json({ message: 'Team training compliance retrieved successfully', data, success: true });
  }));

  router.get('/team/compliance/:partnerId', validate({ params: MemberParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await memberDetail.execute({ requesterId: req.auth?.partnerId, partnerId: params.partnerId });
    res.status(200).json({ message: 'Team member training retrieved successfully', data, success: true });
  }));

  router.post('/team/nudge', validate({ body: z.object({ partnerId: objectId, note: z.string().trim().max(280).optional().default('') }) }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await nudge.execute({ requesterId: req.auth?.partnerId, partnerId: body.partnerId, note: body.note ?? '' });
    res.status(200).json({ message: data.status === 'notified' ? 'Nudge sent' : `Nudge skipped (${data.reason})`, data, success: true });
  }));

  router.get('/mine/certificates', asyncHandler(async (req, res) => {
    const data = await certs.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Certificates retrieved successfully', data, success: true });
  }));

  return router;
};

export default buildTrainingRouter();
