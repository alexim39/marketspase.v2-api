import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import {
    deleteSMS,
    getSMSCreatedBy
} from '../controllers/sms.controller.js'
const SmsRouter = express.Router();

// Legacy write route retired — sends go through session-owned
// v1/outreach/sms. Read/delete stay for historical inbox rows.
// get sms
SmsRouter.get('/getById/:partnerId', requireAuth, getSMSCreatedBy);
// delete sms
SmsRouter.delete('/delete-single/:id', requireAuth, deleteSMS );


export default SmsRouter;