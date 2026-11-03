import express from 'express';
const app = express();
app.use(express.json()); // Use json middleware
app.use(express.urlencoded({extended: false})); // Use formdata middleware
import EmailSubscriptionRouter from './routes/email-subscription.route.js';
export default EmailSubscriptionRouter;