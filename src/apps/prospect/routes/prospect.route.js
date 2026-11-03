import express from 'express';
import {
    CreateContactList,  GetContactsCreatedBy,  importSurveyToContact, getAllMySurveyProspect, ImportSingleProspectFromSurveyToContact,
    getProspectById, UpdateProspectStatus, UpdateProspectsStatusMany, UpdateProspectRemark, deleteSingleFromProspect, UpdateContactList, getSurveyProspectFor, moveSingleProspectBackToSurvey
} from '../controllers/prospect.controller.js'
import { UpdateProspectCommunications, DeleteProspectCommunication} from '../controllers/communictions.controller.js'
import { requireAuth } from '../../../shared/http/requireAuth.js';
const ProspectRouter = express.Router();

// create — session-owned (server stamps the caller's partnerId)
ProspectRouter.post('/create', requireAuth, CreateContactList);
// update — owner or admin (upline coaches, never rewrites PII)
ProspectRouter.put('/update', requireAuth, UpdateContactList);
// Get all contacts createdBy — owner, upline or admin
ProspectRouter.get('/all-createdBy/:createdBy', requireAuth, GetContactsCreatedBy);
// Get all surver prospect for — owner, upline or admin
ProspectRouter.get('/for/:createdBy', requireAuth, getSurveyProspectFor);
// REMOVED: GET /all (unbounded unmasked pool dump, no callers) — admins use
// the paginated, geo-fenced Buy Prospect pool and Admin → Lead pool desks.
// Get all surver prospect gotton by the system (Username !== business) — owner or admin
ProspectRouter.get('/my/:username', requireAuth, getAllMySurveyProspect);
// import prospect for user — owner, upline or admin of the target
ProspectRouter.get('/import/:partnerId', requireAuth, importSurveyToContact );
// import signle prospect for user — paid claim, session must own the partnerId
ProspectRouter.get('/import-single/:partnerId/:prospectId/:source', requireAuth, ImportSingleProspectFromSurveyToContact );
// delete signle prospect for user on survey model
//ProspectRouter.get('/delete-single/:prospectId', deleteSingleFromSurvey );
// get signle prospect byid — owner, upline or admin
ProspectRouter.get('/getById/:prospectId', requireAuth, getProspectById );
// update status — owner, upline (support) or admin
ProspectRouter.post('/updateStatus', requireAuth, UpdateProspectStatus);
// bulk update statuses — same rule, per prospect (one round trip, honest partial outcome)
ProspectRouter.post('/updateStatusMany', requireAuth, UpdateProspectsStatusMany);
// update coaching note — owner, upline (support) or admin
ProspectRouter.post('/updateRemark', requireAuth, UpdateProspectRemark);
// delete signle prospect for user on prospect model — owner or admin
ProspectRouter.get('/delete/:prospectId', requireAuth, deleteSingleFromProspect );
// update prospect communications — owner, upline (support) or admin
ProspectRouter.post('/communications', requireAuth, UpdateProspectCommunications);
// delete communication entry from array — owner or admin
ProspectRouter.delete('/communications/:prospectId/:communicationId', requireAuth, DeleteProspectCommunication );
// Move prospect back to survey list — owner or admin
ProspectRouter.get('/move-back-to-survey/:prospectId', requireAuth, moveSingleProspectBackToSurvey );


export default ProspectRouter;
