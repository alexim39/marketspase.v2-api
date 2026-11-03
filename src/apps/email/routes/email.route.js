import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import {
    SendSingleEmailsToProspect, deleteEmail,
    SendEmailsToProspect,
    getEmailsCreatedBy
} from '../controllers/email.controller.js'
const EmailRouter = express.Router();

// Legacy send surface: the SPA sends through session-owned
// v1/outreach/email now. Authenticated-only so anonymous callers can no
// longer relay mail through our domain (phishing/SPF risk).
// Single email
EmailRouter.post('/send-emails', requireAuth, SendSingleEmailsToProspect);
// builk email
EmailRouter.post('/send-email', requireAuth, SendEmailsToProspect);
// get email
EmailRouter.get('/getById/:partnerId', requireAuth, getEmailsCreatedBy);
// delete email
EmailRouter.delete('/delete-single/:id', requireAuth, deleteEmail );


export default EmailRouter;