import express from 'express';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  ProspectIdParam, PartnerIdParam, CreateProspectSchema, ImportContactsSchema, UpdateProspectSchema,
  UpdateStatusSchema, LogCommunicationSchema, PaginationQuery, CommIdsParam, StuckQuery,
  ConvertProspectSchema, ClaimProspectSchema, AcceptPageLeadSchema, PoolQuery, RateLeadSchema, ImportLeadsSchema,
  AdminLeadsQuery, LeadIdParam, AdminPageLeadsQuery, PageLeadIdParam, ReassignPageLeadSchema, PushPoolLeadSchema,
} from './Prospect.validator.js';
import { requireRole } from '../../identity-access/interface/RequireRole.js';
import { makeProspectController } from './Prospect.controller.js';
import {
  CreateProspectUseCase, UpdateProspectUseCase, UpdateProspectStatusUseCase, DeleteProspectUseCase,
} from '../application/Prospect.commands.js';
import { LogCommunicationUseCase, RemoveCommunicationUseCase } from '../application/Prospect.communications.js';
import { GetMyContactListUseCase, ListActivationBoardUseCase, ListDownlineContactListsUseCase, SubmitContactListUseCase } from '../application/ContactList.usecases.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { MongoProgressionStore } from '../../progression/infrastructure/Progression.mongo.repository.js';
import {
  GetFollowUpRemindersUseCase, GetProspectByIdUseCase, GetProspectsByPartnerUseCase, GetProspectNotificationsUseCase,
  GetStuckProspectsUseCase,
} from '../application/Prospect.queries.js';
import { MongoProspectRepository, MongoPartnerLookup, MongoReservationCodes } from '../infrastructure/Prospect.mongo.repository.js';
import { MongoCampaignLookup } from '../../marketing/infrastructure/Marketing.mongo.repository.js';
import { ConvertProspectToPartnerUseCase } from '../application/Prospect.convert.js';
import { ImportContactsUseCase } from '../application/Prospect.import.js';
import { buildProspectAccess } from '../application/Prospect.access.js';
import { PartnersModel } from '../infrastructure/Prospect.models.js';
import { ReleaseProspectToPoolUseCase } from '../application/Prospect.release.js';
import { ClaimPoolLeadUseCase } from '../application/Prospect.claim.js';
import { PushPoolLeadToPartnerUseCase } from '../application/Prospect.push.js';
import { AssignPoolLeadToPartnerUseCase } from '../application/Prospect.push.js';
import { AcceptPageLeadUseCase } from '../application/Prospect.accept.js';
import { GetPoolUseCase, RateLeadUseCase, ImportLeadsUseCase } from '../application/Prospect.pool.js';
import {
  ListAdminLeadsUseCase, DeleteAdminLeadUseCase, ResetAdminLeadUseCase,
} from '../application/Prospect.pool.js';
import {
  ListAdminPageLeadsUseCase, DeleteAdminPageLeadUseCase, ReassignAdminPageLeadUseCase,
} from '../application/Prospect.pageLeads.js';
import { recordAudit } from '../../audit/index.js';import { domainEvents } from '../../../shared/events/DomainEvents.js';

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
  const reservations = deps.reservations ?? new MongoReservationCodes();
  const campaigns = deps.campaigns ?? new MongoCampaignLookup();

  const network = deps.network ?? new MongoNetworkRepository();
  const progress = deps.progress ?? new MongoProgressionStore();
  const events = deps.events ?? domainEvents;
  // Ownership guard: owner/upline/admin for reads + support writes,
  // owner/admin for PII, deletes and converts. Null-safe in tests via deps.
  const guard = deps.guard ?? buildProspectAccess({
    findProspectById: (id) => prospects.findById(id),
    findPartnerById: (id) => PartnersModel.findById(id).select('role email partnerOf').lean(),
  });
  const create = new CreateProspectUseCase({ prospects, campaigns });
  const c = makeProspectController({
    create,
    importContacts: new ImportContactsUseCase({ create }),
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
    convert: new ConvertProspectToPartnerUseCase({ prospects, reservations }),
    release: new ReleaseProspectToPoolUseCase({ prospects }),
    claim: new ClaimPoolLeadUseCase({}),
    pool: new GetPoolUseCase({}),
    rate: new RateLeadUseCase({}),
    importLeads: new ImportLeadsUseCase({}),
    adminLeads: new ListAdminLeadsUseCase({}),
    adminLeadDelete: new DeleteAdminLeadUseCase({}),
    adminLeadReset: new ResetAdminLeadUseCase({}),
    contactListMine: new GetMyContactListUseCase({ prospects }),
    contactListSubmit: deps.contactListSubmit
      ?? new SubmitContactListUseCase({ prospects, network, events }),
    contactListDownline: new ListDownlineContactListsUseCase({ prospects, network }),
    contactListActivation: new ListActivationBoardUseCase({ prospects, network, progress }),
  }, { guard });

  const router = express.Router();
  // Session identity for every route (matches all other v1 routers) —
  // contact-list endpoints and session-owned creation depend on req.auth.
  router.use(requireAuth);

  router.post('/', validate({ body: CreateProspectSchema }), c.create);
  router.post('/create', validate({ body: CreateProspectSchema }), c.create);
  router.post('/import', validate({ body: ImportContactsSchema }), c.importContacts);

  // NOTE: static single-segment aliases MUST precede `/:prospectId` or Express swallows them as ids.
  // Contact-list endpoints likewise precede every `/:prospectId/*` route.
  router.get('/contact-list/mine', c.contactListMine);
  router.post('/contact-list/submit', c.contactListSubmit);
  router.get('/contact-list/downline', c.contactListDownline);
  router.get('/contact-list/activation', c.contactListActivation);
  router.get('/pool', validate({ query: PoolQuery }), c.pool);
  router.put('/update', validate({ body: UpdateProspectSchema }), c.update);
  router.put('/:prospectId', validate({ params: ProspectIdParam, body: UpdateProspectSchema }), c.update);

  router.get('/by-partner/:partnerId', validate({ params: PartnerIdParam, query: PaginationQuery }), c.getByPartner);
  router.get('/all-createdBy/:createdBy', validate({ query: PaginationQuery }), c.getByPartner);

  // Session-owned follow-up reminders — static path precedes `/:prospectId`.
  router.get('/reminders/mine', c.remindersMine);

  router.get('/notifications/:partnerId', validate({ params: PartnerIdParam }), c.notifications);

  router.get('/stuck/:partnerId', validate({ params: PartnerIdParam, query: StuckQuery }), c.stuck);

  router.get('/:prospectId', validate({ params: ProspectIdParam }), c.getById);
  router.get('/getById/:prospectId', validate({ params: ProspectIdParam }), c.getById);

  router.post('/:prospectId/status', validate({ params: ProspectIdParam, body: UpdateStatusSchema }), c.updateStatus);
  router.post('/updateStatus', validate({ body: UpdateStatusSchema }), c.updateStatus);

  router.post('/:prospectId/convert', validate({ params: ProspectIdParam, body: ConvertProspectSchema }), c.convert);

  router.post('/:prospectId/release', validate({ params: ProspectIdParam }), c.release);

  router.post('/:prospectId/rate', validate({ params: ProspectIdParam, body: RateLeadSchema }), c.rate);

  router.post('/claim', validate({ body: ClaimProspectSchema }), c.claim);

  router.post('/accept-page-lead', validate({ body: AcceptPageLeadSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const accepter = deps.acceptPageLead ?? new AcceptPageLeadUseCase({});
    const data = await accepter.execute({ partnerId: req.auth?.partnerId, surveyId: body.surveyId });
    res.status(200).json({ message: 'Lead accepted — find it in My follow-ups.', data, success: true });
  }));

  router.get('/pool', validate({ query: PoolQuery }), c.pool);

  router.post('/:prospectId/rate', validate({ params: ProspectIdParam, body: RateLeadSchema }), c.rate);

  router.post('/admin/leads/import', requireRole('admin'), validate({ body: ImportLeadsSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    // Route-scope usecase (c.* are req/res handlers, not usecases) so the
    // audit below can record the outcome.
    const importer = deps.importLeads ?? new ImportLeadsUseCase({});
    const data = await importer.execute({ rows: body.rows });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'lead.import',
      targetType: 'leadpool', targetId: null,
      detail: { inserted: data.inserted, failed: data.failed.length, total: data.total },
    });
    res.status(200).json({ message: `Imported ${data.inserted} of ${data.total} leads`, data, success: true });
  }));

  // Admin pool desk — full-platform view (members see only their state).
  router.get('/admin/leads', requireRole('admin'), validate({ query: AdminLeadsQuery }), c.adminLeads);

  router.delete('/admin/leads/:leadId', requireRole('admin'), validate({ params: LeadIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    // Route-scope usecase (c.* are req/res handlers, not usecases).
    const remover = deps.adminLeadDelete ?? new DeleteAdminLeadUseCase({});
    const data = await remover.execute({ id: params.leadId });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'lead.delete',
      targetType: 'leadpool', targetId: data.id,
      detail: { name: data.name },
    });
    res.status(200).json({ message: `Pool lead deleted${data.name ? ` (${data.name})` : ''}`, data, success: true });
  }));

  router.patch('/admin/leads/:leadId', requireRole('admin'), validate({ params: LeadIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    // Route-scope usecase (c.* are req/res handlers, not usecases).
    const resetter = deps.adminLeadReset ?? new ResetAdminLeadUseCase({});
    const data = await resetter.execute({ id: params.leadId });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'lead.status',
      targetType: 'leadpool', targetId: data.id,
      detail: { status: data.status },
    });
    res.status(200).json({ message: 'Pool lead reopened — it is claimable again', data, success: true });
  }));

  router.post('/admin/leads/:leadId/push', requireRole('admin'), validate({ params: LeadIdParam, body: PushPoolLeadSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    // Route-scope usecase (c.* are req/res handlers, not usecases).
    const pusher = deps.adminLeadPush ?? new PushPoolLeadToPartnerUseCase({});
    const data = await pusher.execute({ leadId: params.leadId, username: body.username });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'poollead.push',
      targetType: 'leadpool', targetId: params.leadId,
      detail: { username: data.username, prospectId: data.prospectId },
    });
    res.status(200).json({ message: `Lead pushed to @${data.username} — free, in their pipeline now`, data, success: true });
  }));

  router.post('/admin/leads/:leadId/assign', requireRole('admin'), validate({ params: LeadIdParam, body: PushPoolLeadSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    // Route-scope usecase (c.* are req/res handlers, not usecases).
    const assigner = deps.adminLeadAssign ?? new AssignPoolLeadToPartnerUseCase({});
    const data = await assigner.execute({ leadId: params.leadId, username: body.username });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'poollead.assign',
      targetType: 'leadpool', targetId: params.leadId,
      detail: { username: data.username },
    });
    res.status(200).json({ message: `Lead assigned to @${data.username} — in their My Page Leads inbox`, data, success: true });
  }));

  // Admin page-lead desk — private /:username submissions (never pool rows).
  router.get('/admin/page-leads', requireRole('admin'), validate({ query: AdminPageLeadsQuery }), asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const lister = deps.adminPageLeads ?? new ListAdminPageLeadsUseCase({});
    const data = await lister.execute({
      q: q.q, owner: q.owner, state: q.state,
      status: q.status && q.status !== 'all' ? q.status : null,
      limit: q.limit, skip: q.skip,
    });
    res.status(200).json({ message: 'Page leads retrieved successfully', data, success: true });
  }));

  router.delete('/admin/page-leads/:pageLeadId', requireRole('admin'), validate({ params: PageLeadIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const remover = deps.adminPageLeadDelete ?? new DeleteAdminPageLeadUseCase({});
    const data = await remover.execute({ id: params.pageLeadId });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'pagelead.delete',
      targetType: 'pagelead', targetId: data.id,
      detail: { name: data.name, owner: data.owner },
    });
    res.status(200).json({ message: `Page lead deleted${data.name ? ` (${data.name})` : ''}`, data, success: true });
  }));

  router.patch('/admin/page-leads/:pageLeadId', requireRole('admin'), validate({ params: PageLeadIdParam, body: ReassignPageLeadSchema }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const reassigner = deps.adminPageLeadReassign ?? new ReassignAdminPageLeadUseCase({});
    const data = await reassigner.execute({ id: params.pageLeadId, owner: body.owner });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'pagelead.reassign',
      targetType: 'pagelead', targetId: data.id,
      detail: { owner: data.owner },
    });
    res.status(200).json({ message: `Page lead moved to @${data.owner} — visible in their My Page Leads`, data, success: true });
  }));

  router.post('/:prospectId/communications', validate({ params: ProspectIdParam, body: LogCommunicationSchema }), c.logCommunication);
  router.post('/communications', validate({ body: LogCommunicationSchema }), c.logCommunication);
  router.delete('/:prospectId/communications/:communicationId', validate({ params: CommIdsParam }), c.removeCommunication);
  router.delete('/communications/:prospectId/:communicationId', validate({ params: CommIdsParam }), c.removeCommunication);

  router.delete('/:prospectId', validate({ params: ProspectIdParam }), c.remove);
  router.get('/delete/:prospectId', validate({ params: ProspectIdParam }), c.remove); // legacy GET-as-delete alias

  return router;
};

export default buildProspectRouter();
