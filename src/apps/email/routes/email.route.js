import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import {
    deleteEmail,
    getEmailsCreatedBy
} from '../controllers/email.controller.js'
const EmailRouter = express.Router();

// Legacy send routes retired — the SPA sends through session-owned
// v1/outreach/email (validated, capped, recorded). Read/delete stay for
// historical inbox rows.
// get email
EmailRouter.get('/getById/:partnerId', requireAuth, getEmailsCreatedBy);
// delete email
EmailRouter.delete('/delete-single/:id', requireAuth, deleteEmail );


export default EmailRouter;