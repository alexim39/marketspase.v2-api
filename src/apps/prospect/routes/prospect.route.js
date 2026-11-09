import express from 'express';
import { z } from 'zod';
import {
    CreateContactList,  GetContactsCreatedBy, getAllMySurveyProspect,
    getProspectById, UpdateProspectStatus, UpdateProspectsStatusMany, UpdateProspectRemark, deleteSingleFromProspect, UpdateContactList, getSurveyProspectFor
} from '../controllers/prospect.controller.js'
import { UpdateProspectCommunications, DeleteProspectCommunication} from '../controllers/communictions.controller.js'
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
const ProspectRouter = express.Router();

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid prospect id');
const email = z.union([z.string().trim().email().max(254), z.literal('')]).optional();
const dateValue = z.union([z.string().trim().min(1).max(40), z.date()]);
const relationship = z.enum(['Family', 'Friend', 'Colleague', 'Church', 'Neighbour', 'Referral', 'Other']);

const prospectFields = {
  prospectName: z.string().trim().min(1).max(120),
  prospectSurname: z.string().trim().max(120).optional(),
  prospectPhone: z.string().trim().min(7).max(30),
  prospectEmail: email,
  prospectSource: z.string().trim().min(1).max(120),
  prospectRemark: z.string().trim().max(2000).optional(),
  relationship: relationship.optional(),
  priority: z.enum(['high', 'normal']).optional(),
  bestTimeToCall: z.string().trim().max(120).optional(),
  consentToContact: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
  survey: z.object({
    ageRange: z.string().trim().max(40).optional(),
    socialMedia: z.array(z.string().trim().max(60)).max(20).optional(),
    employedStatus: z.string().trim().max(80).optional(),
    importanceOfPassiveIncome: z.string().trim().max(80).optional(),
    onlinePurchaseSchedule: z.string().trim().max(80).optional(),
    primaryOnlineBusinessMotivation: z.string().trim().max(120).optional(),
    comfortWithTech: z.string().trim().max(80).optional(),
    onlineBusinessTimeDedication: z.string().trim().max(80).optional(),
    referralCode: z.string().trim().max(80).optional(),
    referral: z.string().trim().max(120).optional(),
    country: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
  }).optional(),
};

const ProspectCreate = z.object(prospectFields);
const ProspectUpdate = z.object({
  ...prospectFields,
  prospectId: objectId,
  prospectName: prospectFields.prospectName.optional(),
  prospectPhone: prospectFields.prospectPhone.optional(),
  prospectSource: prospectFields.prospectSource.optional(),
});

const ProspectStatus = z.object({
  prospectId: objectId,
  status: z.object({
    name: z.string().trim().min(1).max(120),
    note: z.string().trim().max(2000).optional(),
    paydayDate: dateValue.optional(),
    expectedDecisionDate: dateValue.optional(),
    onboardingDate: dateValue.optional(),
  }),
});

const ProspectStatusMany = z.object({
  prospectIds: z.array(objectId).min(1).max(100),
  status: z.string().trim().min(1).max(120),
});

const ProspectRemark = z.object({
  prospectId: objectId,
  remark: z.string().trim().min(1).max(2000),
});

const ProspectCommunication = z.object({
  prospectId: objectId,
  interestLevel: z.enum(['hot', 'warm', 'cold']),
  date: dateValue,
  type: z.enum(['call', 'email', 'text', 'zoom', 'whatsapp', 'presentation']),
  duration: z.coerce.number().int().min(0).max(1440).optional(),
  description: z.string().trim().min(1).max(2000),
  topicsDiscussed: z.union([
    z.array(z.string().trim().min(1).max(120)).max(30),
    z.string().trim().max(2000),
  ]).optional(),
});

// create — session-owned (server stamps the caller's partnerId)
ProspectRouter.post('/create', requireAuth, validateBodyInPlace(ProspectCreate), CreateContactList);
// update — owner or admin (upline coaches, never rewrites PII)
ProspectRouter.put('/update', requireAuth, validateBodyInPlace(ProspectUpdate), UpdateContactList);
// Get all contacts createdBy — owner, upline or admin
ProspectRouter.get('/all-createdBy/:createdBy', requireAuth, GetContactsCreatedBy);
// Get all surver prospect for — owner, upline or admin
ProspectRouter.get('/for/:createdBy', requireAuth, getSurveyProspectFor);
// REMOVED: GET /all (unbounded unmasked dump, no callers).
// Get all surver prospect gotton by the system (Username !== business) — owner or admin
ProspectRouter.get('/my/:username', requireAuth, getAllMySurveyProspect);
// import prospect for user - owner, upline or admin of the target
// REMOVED: warm-list import is retired.
// get signle prospect byid — owner, upline or admin
ProspectRouter.get('/getById/:prospectId', requireAuth, getProspectById );
// update status — owner, upline (support) or admin
ProspectRouter.post('/updateStatus', requireAuth, validateBodyInPlace(ProspectStatus), UpdateProspectStatus);
// bulk update statuses — same rule, per prospect (one round trip, honest partial outcome)
ProspectRouter.post('/updateStatusMany', requireAuth, validateBodyInPlace(ProspectStatusMany), UpdateProspectsStatusMany);
// update coaching note — owner, upline (support) or admin
ProspectRouter.post('/updateRemark', requireAuth, validateBodyInPlace(ProspectRemark), UpdateProspectRemark);
// delete signle prospect for user on prospect model — owner or admin
ProspectRouter.get('/delete/:prospectId', requireAuth, deleteSingleFromProspect );
// update prospect communications — owner, upline (support) or admin
ProspectRouter.post('/communications', requireAuth, validateBodyInPlace(ProspectCommunication), UpdateProspectCommunications);
// delete communication entry from array — owner or admin
ProspectRouter.delete('/communications/:prospectId/:communicationId', requireAuth, DeleteProspectCommunication );
// REMOVED: move prospect back to the retired survey list.


export default ProspectRouter;
