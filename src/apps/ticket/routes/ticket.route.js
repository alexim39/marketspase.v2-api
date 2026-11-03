import express from 'express';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { 
    saveTicket,
} from '../controllers/ticket.controller.js'
const TicketRouter = express.Router();

// Public support form — throttled per IP against ticket spam.
TicketRouter.post('/submit', rateLimit({ name: 'ticket-submit', windowMs: 10 * 60 * 1000, max: 10 }), saveTicket);


export default TicketRouter;
