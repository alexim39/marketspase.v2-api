import express from 'express';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { 
    emailSubscription,
    confirmEmailSubscription,
    unsubscribeEmailSubscription,
    deleteSingleEmailFromEmailList
} from '../controllers/email-subscription.controller.js'
const EmailSubscriptionRouter = express.Router();

const subscribeLimit = rateLimit({ name: 'email-subscribe', windowMs: 10 * 60 * 1000, max: 5 });
const tokenLimit = rateLimit({ name: 'email-token', windowMs: 60 * 1000, max: 30 });

EmailSubscriptionRouter.post('/subscribe', subscribeLimit, emailSubscription);
EmailSubscriptionRouter.get('/confirm/:token', tokenLimit, confirmEmailSubscription);
EmailSubscriptionRouter.get('/unsubscribe/:token', tokenLimit, unsubscribeEmailSubscription);
EmailSubscriptionRouter.get('/delete-email/:emailId', deleteSingleEmailFromEmailList );


export default EmailSubscriptionRouter;