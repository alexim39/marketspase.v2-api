import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  AddEventCommentUseCase, CancelEventUseCase, CreateEventUseCase, DeleteEventCommentUseCase, FeatureEventUseCase, GetEventUseCase, ListAttendeesUseCase, ListEventCommentsUseCase, ListMyEventsUseCase,
  ListUpcomingUseCase, MarkAttendanceUseCase, RsvpUseCase, UpdateEventUseCase,
} from '../application/Events.usecases.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';
import { MongoEventStore } from '../infrastructure/Events.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { AUDIENCE_SCOPES, RSVP_STATUSES } from '../domain/Event.entity.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

const EventSchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(2000),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  location: z.string().trim().max(200).optional().default(''),
  scope: z.enum(['global', 'team', 'leadership', 'members']),
  teamId: objectId.optional(),
}).refine(
  (e) => e.endsAt === undefined || new Date(e.endsAt) > new Date(e.startsAt),
  { message: 'Event end must be after its start', path: ['endsAt'] },
).refine(
  (e) => e.scope !== 'members' || e.teamId !== undefined,
  { message: 'Team events need a team', path: ['teamId'] },
);

const RsvpSchema = z.object({ status: z.enum(RSVP_STATUSES) });
const CommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  parentId: objectId.optional(),
});
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).optional() });
const EventIdParam = z.object({ eventId: objectId });

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildEventsRouter = (deps = {}) => {
  const events = deps.events ?? new MongoEventStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const progress = deps.progress ?? new MongoProgressionStore();

  const create = new CreateEventUseCase({ events });
  const upcoming = new ListUpcomingUseCase({ events, network, progress });
  const mine = new ListMyEventsUseCase({ events });
  const detail = new GetEventUseCase({ events, network, progress });
  const rsvp = new RsvpUseCase({ events, network, progress });
  const cancel = new CancelEventUseCase({ events });
  const update = new UpdateEventUseCase({ events });
  const listComments = new ListEventCommentsUseCase({ events, network, progress });
  const addComment = new AddEventCommentUseCase({ events, network, progress });
  const deleteComment = new DeleteEventCommentUseCase({ events });
  const feature = deps.feature ?? new FeatureEventUseCase({
    events,
    partners: deps.partners ?? new MongoPartnerRepository(),
  });
  const attendees = deps.attendees ?? new ListAttendeesUseCase({
    events,
    partners: deps.partners ?? new MongoPartnerRepository(),
  });
  const markAttendance = deps.markAttendance ?? new MarkAttendanceUseCase({
    events,
    partners: deps.partners ?? new MongoPartnerRepository(),
  });

  const FeatureSchema = z.object({
    featured: z.boolean(),
    featuredUntil: z.coerce.date().optional(),
  });

  const router = express.Router();
  router.use(requireAuth);

  router.get('/upcoming', validate({ query: LimitQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await upcoming.execute({ viewerId: req.auth?.partnerId, limit: q?.limit });
    res.status(200).json({ message: 'Upcoming events retrieved successfully', data, success: true });
  }));

  router.get('/mine', asyncHandler(async (req, res) => {
    const data = await mine.execute({ authorId: req.auth?.partnerId });
    res.status(200).json({ message: 'My events retrieved successfully', data, success: true });
  }));

  router.post('/', validate({ body: EventSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await create.execute({ authorId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: 'Event created successfully', data, success: true });
  }));

  router.get('/:eventId', validate({ params: EventIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await detail.execute({ partnerId: req.auth?.partnerId, eventId: params.eventId });
    res.status(200).json({ message: 'Event retrieved successfully', data, success: true });
  }));

  router.post('/:eventId/rsvp', validate({ params: EventIdParam, body: RsvpSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await rsvp.execute({ partnerId: req.auth?.partnerId, eventId: params.eventId, status: body?.status });
    res.status(200).json({ message: 'RSVP saved successfully', data, success: true });
  }));

  // Organizer desk — attendee PII stays behind author-or-admin.
  router.get('/:eventId/attendees', validate({ params: EventIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await attendees.execute({ partnerId: req.auth?.partnerId, eventId: params.eventId });
    res.status(200).json({ message: 'Attendees retrieved successfully', data, success: true });
  }));

  router.post('/:eventId/attendance', validate({
    params: EventIdParam,
    body: z.object({ partnerId: objectId, attended: z.boolean() }),
  }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await markAttendance.execute({
      partnerId: req.auth?.partnerId, eventId: params.eventId,
      attendeeId: body?.partnerId, attended: body?.attended === true,
    });
    res.status(200).json({ message: 'Attendance marked successfully', data, success: true });
  }));

  // Discussion — comments + one-level replies (no likes; RSVP is the signal).
  router.get('/:eventId/comments', validate({ params: EventIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await listComments.execute({ partnerId: req.auth?.partnerId, eventId: params.eventId });
    res.status(200).json({ message: 'Event comments retrieved successfully', data, success: true });
  }));

  router.post('/:eventId/comments', validate({ params: EventIdParam, body: CommentSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await addComment.execute({
      partnerId: req.auth?.partnerId, eventId: params.eventId,
      body: body?.body, parentId: body?.parentId ?? null,
    });
    res.status(200).json({ message: 'Comment posted successfully', data, success: true });
  }));

  router.delete('/:eventId/comments/:commentId', validate({ params: z.object({ eventId: objectId, commentId: objectId }) }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await deleteComment.execute({
      partnerId: req.auth?.partnerId, eventId: params.eventId, commentId: params.commentId,
    });
    res.status(200).json({ message: 'Comment deleted successfully', data, success: true });
  }));

  router.post('/:eventId/cancel', validate({ params: EventIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await cancel.execute({ partnerId: req.auth?.partnerId, eventId: params.eventId });
    res.status(200).json({ message: 'Event cancelled successfully', data, success: true });
  }));

  router.post('/:eventId/feature', validate({ params: EventIdParam, body: FeatureSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await feature.execute({
      partnerId: req.auth?.partnerId,
      eventId: params.eventId,
      featured: body?.featured,
      featuredUntil: body?.featuredUntil ?? null,
    });
    res.status(200).json({ message: body?.featured ? 'Event featured at top' : 'Event unfeatured', data, success: true });
  }));

  router.put('/:eventId', validate({ params: EventIdParam, body: EventSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await update.execute({ partnerId: req.auth?.partnerId, eventId: params.eventId, ...body });
    res.status(200).json({ message: 'Event updated successfully', data, success: true });
  }));

  return router;
};

export default buildEventsRouter();
