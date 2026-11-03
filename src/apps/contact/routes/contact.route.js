import express from 'express';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { ContactController, DownloadPreapproachController } from '../controllers/contact.controller.js'
const ContactRouter = express.Router();

// Public contact forms — throttled per IP against spam.
const formLimit = rateLimit({ name: 'contact-submit', windowMs: 10 * 60 * 1000, max: 10 });
// User contact
ContactRouter.post('/submit', formLimit, ContactController);
// Download pre-approach
ContactRouter.post('/pre-approach', formLimit, DownloadPreapproachController);


export default ContactRouter;
