import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import {
  CompleteLessonUseCase,
  GetCourseUseCase,
  ListCoursesUseCase,
  MyCertificatesUseCase,
  NudgeMemberUseCase,
  RecordWatchUseCase,
  TeamComplianceUseCase,
  TeamMemberDetailUseCase,
} from '../application/Training.usecases.js';
import { NotifyUseCase } from '../../notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { ListPathsUseCase } from '../application/Training.paths.usecase.js';
import { ReadinessUseCase } from '../application/Training.readiness.usecase.js';
import { GetMyProgressionUseCase } from '../../progression/application/Progression.usecases.js';
import { MongoTrainingStore } from '../infrastructure/Training.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoOrderReader } from '../../billing/infrastructure/Billing.mongo.repository.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';
import { MongoEventStore } from '../../events/infrastructure/Events.mongo.repository.js';
import { RecognitionUseCases } from '../../community/application/Community.usecases.js';
import { MongoCommunityStore } from '../../community/infrastructure/Community.mongo.repository.js';

// Course/lesson ids are Mongo ObjectIds, but accept a short-ish string so old
// bookmarked URLs return a friendly 404 instead of a validation error.
const idLike = z.string().trim().min(1).max(64);
const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const CourseParam = z.object({ courseId: idLike });
const LessonParam = z.object({ courseId: idLike, lessonId: idLike });
const MemberParam = z.object({ partnerId: objectId });
const CompleteBody = z.object({
  answers: z.array(z.number().int().min(0).max(10)).optional(),
});
const WatchBody = z.object({
  percent: z.number().min(0).max(100),
  seconds: z.number().int().min(0).max(43200).optional().default(0),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildTrainingRouter = (deps = {}) => {
  const training = deps.training ?? new MongoTrainingStore();
  const progress = deps.progress ?? new MongoProgressionStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const communityStore = deps.community ?? new MongoCommunityStore();
  const recognition = deps.recognition ?? new RecognitionUseCases({ community: communityStore });

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
  const readiness = new ReadinessUseCase({
    progression: deps.progression ?? new GetMyProgressionUseCase({
      progress,
      network,
      orders: deps.orders ?? new MongoOrderReader(),
      recognition: null,
      prospects: deps.prospects ?? new MongoProspectRepository(),
      community: communityStore,
      eventStore: deps.eventStore ?? new MongoEventStore(),
    }),
  });

  const router = express.Router();
  router.use(deps.auth ?? requireAuth);

  router.get('/paths', asyncHandler(async (req, res) => {
    const data = await paths.execute({ partnerId: req.auth?.partnerId });
    return sendSuccess(res, { message: 'Learning paths retrieved successfully', data });
  }));

  router.get('/readiness', asyncHandler(async (req, res) => {
    const data = await readiness.execute({ partnerId: req.auth?.partnerId });
    return sendSuccess(res, { message: 'Promotion readiness retrieved successfully', data });
  }));

  router.get('/courses', asyncHandler(async (req, res) => {
    const data = await list.execute({ partnerId: req.auth?.partnerId });
    return sendSuccess(res, { message: 'Courses retrieved successfully', data });
  }));

  router.get('/courses/:courseId', validate({ params: CourseParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await detail.execute({ partnerId: req.auth?.partnerId, courseId: params.courseId });
    return sendSuccess(res, { message: 'Course retrieved successfully', data });
  }));

  router.post('/courses/:courseId/lessons/:lessonId/complete', validate({ params: LessonParam, body: CompleteBody }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await complete.execute({
      partnerId: req.auth?.partnerId,
      courseId: params.courseId,
      lessonId: params.lessonId,
      answers: body.answers,
    });
    return sendSuccess(res, {
      message: data.certified
        ? 'Course completed and certificate issued'
        : 'Lesson completed successfully',
      data,
    });
  }));

  router.post('/courses/:courseId/lessons/:lessonId/watch', validate({ params: LessonParam, body: WatchBody }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await watch.execute({
      partnerId: req.auth?.partnerId,
      courseId: params.courseId,
      lessonId: params.lessonId,
      percent: body.percent,
      seconds: body.seconds ?? 0,
    });
    return sendSuccess(res, { message: 'Watch progress recorded', data });
  }));

  router.get('/team/compliance', asyncHandler(async (req, res) => {
    const data = await compliance.execute({ requesterId: req.auth?.partnerId, limit: req.query?.limit });
    return sendSuccess(res, { message: 'Team training compliance retrieved successfully', data });
  }));

  router.get('/team/compliance/:partnerId', validate({ params: MemberParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await memberDetail.execute({ requesterId: req.auth?.partnerId, partnerId: params.partnerId });
    return sendSuccess(res, { message: 'Team member training retrieved successfully', data });
  }));

  router.post('/team/nudge', validate({ body: z.object({ partnerId: objectId, note: z.string().trim().max(280).optional().default('') }) }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await nudge.execute({ requesterId: req.auth?.partnerId, partnerId: body.partnerId, note: body.note ?? '' });
    return sendSuccess(res, {
      message: data.status === 'notified' ? 'Nudge sent' : `Nudge skipped (${data.reason})`,
      data,
    });
  }));

  router.get('/mine/certificates', asyncHandler(async (req, res) => {
    const data = await certs.execute({ partnerId: req.auth?.partnerId });
    return sendSuccess(res, { message: 'Certificates retrieved successfully', data });
  }));

  return router;
};

export default buildTrainingRouter();
