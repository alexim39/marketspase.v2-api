import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { 
    getTransactions,
} from '../controllers/transaction.controller.js'
const TransactionRouter = express.Router();

// own transaction history only (controller enforces session ownership).
TransactionRouter.get('/transaction/:partnerId', requireAuth, getTransactions);

export default TransactionRouter;