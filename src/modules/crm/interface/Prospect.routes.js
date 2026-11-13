import express from 'express';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  ProspectIdParam, PartnerIdParam, CreateProspectSchema, UpdateProspectSchema,
  UpdateStatusSchema, LogCommunicationSchema, PaginationQuery, CommIdsParam, StuckQuery,
  ConvertProspectSchema, RateLeadSchema, MentorCheckinSchema, MentorMemberParam,
} from './Prospect.validator.js';
import { makeProspectController } from './Prospect.controller.js';
import {
  CreateProspectUseCase, UpdateProspectUseCase, UpdateProspectStatusUseCase, DeleteProspectUseCase,
} from '../application/Prospect.commands.js';
import { LogCommunicationUseCase, RemoveCommunicationUseCase } from '../application/Prospect.communications.js';
import { ListActivationBoardUseCase } from '../application/ContactList.usecases.js';
import { RecordMentorCheckinUseCase } from '../application/MentorPlaybook.usecases.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import {
  GetFollowUpRemindersUseCase, GetProspectByIdUseCase, GetProspectsByPartnerUseCase, GetProspectNotificationsUseCase,
  GetStuckProspectsUseCase,
} from '../application/Prospect.queries.js';
import { MongoProspectRepository, MongoPartnerLookup } from '../infrastructure/Prospect.mongo.repository.js';
import { ConvertProspectToPartnerUseCase } from '../application/Prospect.convert.js';
import { buildProspectAccess } from '../application/Prospect.access.js';
import { PartnersModel } from '../infrastructure/Prospect.models.js';
import { RateLeadUseCase } from '../application/Prospect.rate.js';
import { domainEvents } from '../../../shared/events/DomainEvents.js';

/**
 * Manual wiring — explicit for onboarding; pass fakes in tests.
 * Canonical REST paths + legacy aliases so clients can switch base URL
 * (`/prospect` → `/v1/prospects`) without changing paths.
 *
 * Survey-coupled legacy routes are INTENTIONALLY absent here
 * (/for/*, /all, /my/*, /import/*, /move-back-to-survey/*) — they read/write
 * the Survey collection and move in the `insight` slice.
 */
export const buildProspectRouter = (deps = {}) => {
  const prospects = deps.prospects ?? new MongoProspectRepository();
  const partners = deps.partners ?? new MongoPartnerLookup();

  const network = deps.network ?? new MongoNetworkRepository();
  const progress = deps.progress ?? new MongoProgressionStore();
  const events = deps.events ?? domainEvents;
  const mentorCheckin = deps.mentorCheckin ?? new RecordMentorCheckinUseCase({ network });
  // Ownership guard: owner/upline/admin for reads + support writes,
  // owner/admin for PII, deletes and converts. Null-safe in tests via deps.
  const guard = deps.guard ?? buildProspectAccess({
    findProspectById: (id) => prospects.findById(id),
    findPartnerById: (id) => PartnersModel.findById(id).select('role email partnerOf').lean(),
  });
  const create = new CreateProspectUseCase({ prospects });
  const c = makeProspectController({
    create,
    update: new UpdateProspectUseCase({ prospects }),
    updateStatus: new UpdateProspectStatusUseCase({ prospects, events }),
    remove: new DeleteProspectUseCase({ prospects }),
    getById: new GetProspectByIdUseCase({ prospects }),
    getByPartner: new GetProspectsByPartnerUseCase({ prospects, partners }),
    logCommunication: new LogCommunicationUseCase({ prospects, events }),
    removeCommunication: new RemoveCommunicationUseCase({ prospects }),
    notifications: new GetProspectNotificationsUseCase({ prospects }),
    stuck: new GetStuckProspectsUseCase({ prospects }),
    reminders: new GetFollowUpRemindersUseCase({ prospects }),
    convert: new ConvertProspectToPartnerUseCase({ prospects }),
    rate: new RateLeadUseCase({}),
    activationBoard: new ListActivationBoardUseCase({ network, progress }),
  }, { guard });

  const router = express.Router();
  // Session identity for every route (matches all other v1 routers) —
  // contact-list endpoints and session-owned creation depend on req.auth.
  router.use(requireAuth);

  router.post('/', validate({ body: CreateProspectSchema }), c.create);
  router.post('/create', validate({ body: CreateProspectSchema }), c.create);

  // Activation board uses training/progression only; contact-list submission
  // and page-lead desks are retired.
  router.get('/activation-board', c.activationBoard);
  router.put('/update', validate({ body: UpdateProspectSchema }), c.update);
  router.put('/:prospectId', validate({ params: ProspectIdParam, body: UpdateProspectSchema }), c.update);

  router.get('/by-partner/:partnerId', validate({ params: PartnerIdParam, query: PaginationQuery }), c.getByPartner);
  router.get('/referral-members/:partnerId', validate({ params: PartnerIdParam, query: PaginationQuery }), c.referralMembers);
  router.get('/all-createdBy/:createdBy', validate({ query: PaginationQuery }), c.getByPartner);

  // Session-owned follow-up reminders — static path precedes `/:prospectId`.
  router.get('/reminders/mine', c.remindersMine);

  router.get('/notifications/:partnerId', validate({ params: PartnerIdParam }), c.notifications);

  router.get('/stuck/:partnerId', validate({ params: PartnerIdParam, query: StuckQuery }), c.stuck);

  router.post(
    '/activation-board/:memberId/checkin',
    validate({ params: MentorMemberParam, body: MentorCheckinSchema }),
    asyncHandler(async (req, res) => {
      const body = req.validated?.body ?? req.body;
      const params = req.validated?.params ?? req.params;
      const data = await mentorCheckin.execute({
        mentorId: req.auth?.partnerId,
        memberId: params.memberId,
        kind: body?.kind ?? 'ad_hoc',
        note: body?.note ?? '',
      });
      res.status(200).json({ message: 'Mentor check-in recorded', data, success: true });
    }),
  );

  router.get('/:prospectId', validate({ params: ProspectIdParam }), c.getById);
  router.get('/getById/:prospectId', validate({ params: ProspectIdParam }), c.getById);

  router.post('/:prospectId/status', validate({ params: ProspectIdParam, body: UpdateStatusSchema }), c.updateStatus);
  router.post('/updateStatus', validate({ body: UpdateStatusSchema }), c.updateStatus);

  router.post('/:prospectId/convert', validate({ params: ProspectIdParam, body: ConvertProspectSchema }), c.convert);

  router.post('/:prospectId/rate', validate({ params: ProspectIdParam, body: RateLeadSchema }), c.rate);

  router.post('/:prospectId/communications', validate({ params: ProspectIdParam, body: LogCommunicationSchema }), c.logCommunication);
  router.post('/communications', validate({ body: LogCommunicationSchema }), c.logCommunication);
  router.delete('/:prospectId/communications/:communicationId', validate({ params: CommIdsParam }), c.removeCommunication);
  router.delete('/communications/:prospectId/:communicationId', validate({ params: CommIdsParam }), c.removeCommunication);

  router.delete('/:prospectId', validate({ params: ProspectIdParam }), c.remove);
  router.get('/delete/:prospectId', validate({ params: ProspectIdParam }), c.remove); // legacy GET-as-delete alias

  return router;
};

export default buildProspectRouter();
