import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import {
    saveSMSDetails, deleteSMS,
    getSMSCreatedBy
} from '../controllers/sms.controller.js'
const SmsRouter = express.Router();

// Legacy record/forgery surface: nothing in the SPA writes here anymore
// (single + bulk sends go through session-owned v1/outreach/sms). Kept
// mounted for old inbox reads — authenticated only.
SmsRouter.post('/save-sms', requireAuth, saveSMSDetails);
// get sms
SmsRouter.get('/getById/:partnerId', requireAuth, getSMSCreatedBy);
// delete sms
SmsRouter.delete('/delete-single/:id', requireAuth, deleteSMS );


export default SmsRouter;