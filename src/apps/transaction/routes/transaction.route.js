import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../../modules/identity-access/interface/RequireRole.js';
import { 
    confirmPayment,
    getTransactions,
    singleSMSCharge,
    bulkSMSCharge, withdrawRequest,
    listWithdrawals, decideWithdrawal
} from '../controllers/transaction.controller.js'
const TransactionRouter = express.Router();

// confirm payment — credited partner must equal the session (see controller).
TransactionRouter.post('/confirm-payment', requireAuth, confirmPayment);
// own transaction history only (controller enforces session ownership).
TransactionRouter.get('/transaction/:partnerId', requireAuth, getTransactions);
// single sms charge — session-owned (see controller).
TransactionRouter.get('/single-sms-charge/:partnerId', requireAuth, singleSMSCharge);
// bulk sms charge — session-owned (see controller).
TransactionRouter.post('/bulk-sms-charge', requireAuth, bulkSMSCharge);
// withdrawal — debited partner must equal the session (see controller).
TransactionRouter.post('/withdraw-request', requireAuth, withdrawRequest);
// Admin queue (role-gated) — must precede nothing conflicting; kept together.
TransactionRouter.get('/withdrawals', requireAuth, requireRole('admin'), listWithdrawals);
TransactionRouter.patch('/withdrawals/:id', requireAuth, requireRole('admin'), decideWithdrawal);


export default TransactionRouter;