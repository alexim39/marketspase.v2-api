import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import {
    deleteEmail,
} from '../controllers/email.controller.js'
const EmailRouter = express.Router();

// Legacy send and read routes retired — the SPA sends through session-owned
// v1/outreach/email and reads historical rows through v1 message endpoints.
// Delete stays so old inbox rows can be tidied.
EmailRouter.delete('/delete-single/:id', requireAuth, deleteEmail );


export default EmailRouter;