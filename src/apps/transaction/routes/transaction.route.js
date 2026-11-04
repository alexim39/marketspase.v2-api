import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { requireRole } from '../../../modules/identity-access/interface/RequireRole.js';
import { 
    getTransactions,
    singleSMSCharge,
    withdrawRequest,
    listWithdrawals, decideWithdrawal
} from '../controllers/transaction.controller.js'
const TransactionRouter = express.Router();

// own transaction history only (controller enforces session ownership).
TransactionRouter.get('/transaction/:partnerId', requireAuth, getTransactions);
// single sms charge — session-owned (see controller).
TransactionRouter.get('/single-sms-charge/:partnerId', requireAuth, singleSMSCharge);
// withdrawal — debited partner must equal the session (see controller).
TransactionRouter.post('/withdraw-request', requireAuth, withdrawRequest);
// Admin queue (role-gated) — must precede nothing conflicting; kept together.
TransactionRouter.get('/withdrawals', requireAuth, requireRole('admin'), listWithdrawals);
TransactionRouter.patch('/withdrawals/:id', requireAuth, requireRole('admin'), decideWithdrawal);


export default TransactionRouter;