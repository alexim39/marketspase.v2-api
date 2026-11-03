import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { AddNoteUseCase, GetMyCoachUseCase, ListNotesUseCase } from '../application/Coaching.usecases.js';
import { MongoCoachingStore } from '../infrastructure/Coaching.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import { MongoTrainingStore } from '../../training/infrastructure/Training.mongo.repository.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildCoachingRouter = (deps = {}) => {
  const coaching = deps.coaching ?? new MongoCoachingStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const progression = deps.progression ?? new MongoProgressionStore();
  const training = deps.training ?? new MongoTrainingStore();

  const myCoach = new GetMyCoachUseCase({ network, progression, training });
  const addNote = new AddNoteUseCase({ coaching, network });
  const listNotes = new ListNotesUseCase({ coaching, network });

  const router = express.Router();
  router.use(requireAuth);

  router.get('/mine', asyncHandler(async (req, res) => {
    const data = await myCoach.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Coach retrieved successfully', data, success: true });
  }));

  router.get('/notes', validate({ query: z.object({ memberId: objectId.optional(), limit: z.coerce.number().int().min(1).max(100).optional().default(50) }) }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await listNotes.execute({ requesterId: req.auth?.partnerId, memberId: q?.memberId, limit: q?.limit });
    res.status(200).json({ message: 'Notes retrieved successfully', data, success: true });
  }));

  router.post('/notes', validate({ body: z.object({ memberId: objectId, body: z.string().trim().min(3).max(2000) }) }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await addNote.execute({ coachId: req.auth?.partnerId, memberId: body.memberId, body: body.body });
    res.status(200).json({ message: 'Note added successfully', data, success: true });
  }));

  return router;
};

export default buildCoachingRouter();
