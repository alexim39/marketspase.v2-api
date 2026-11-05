import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { 
    getTransactions,
    singleSMSCharge,
    withdrawRequest,
} from '../controllers/transaction.controller.js'
const TransactionRouter = express.Router();

// own transaction history only (controller enforces session ownership).
TransactionRouter.get('/transaction/:partnerId', requireAuth, getTransactions);
// single sms charge — session-owned (see controller).
TransactionRouter.get('/single-sms-charge/:partnerId', requireAuth, singleSMSCharge);
// withdrawal — debited partner must equal the session (see controller).
TransactionRouter.post('/withdraw-request', requireAuth, withdrawRequest);


export default TransactionRouter;