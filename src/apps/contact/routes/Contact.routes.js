import express from 'express';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
import { ContactController, DownloadPreapproachController } from '../controllers/contact.controller.js';
import { ContactSubmitSchema, PreapproachSubmitSchema } from './Contact.validator.js';

/**
 * Contract: /v1/contact — public forms, throttled per IP against spam.
 * Validation strips unknown fields before the controller sees the body.
 */
export const buildContactRouter = ({
  submit = ContactController,
  preapproach = DownloadPreapproachController,
} = {}) => {
  const router = express.Router();
  const formLimit = rateLimit({ name: 'contact-submit', windowMs: 10 * 60 * 1000, max: 10 });

  router.post('/submit', formLimit, validateBodyInPlace(ContactSubmitSchema), submit);
  router.post('/pre-approach', formLimit, validateBodyInPlace(PreapproachSubmitSchema), preapproach);

  return router;
};

export default buildContactRouter();
