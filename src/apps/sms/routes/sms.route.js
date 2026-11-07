import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import {
    deleteSMS,
} from '../controllers/sms.controller.js'
const SmsRouter = express.Router();

// Legacy send and read routes retired — the SPA sends through session-owned
// v1/outreach/sms and reads historical rows through v1 message endpoints.
// Delete stays so old inbox rows can be tidied.
SmsRouter.delete('/delete-single/:id', requireAuth, deleteSMS );


export default SmsRouter;