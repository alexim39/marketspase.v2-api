import express from 'express';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
import { PartnerSurveyForm, ProspectSurveyForm } from '../controllers/survey.controller.js';
import { PartnerSurveySchema, ProspectSurveySchema } from './Survey.validator.js';

/**
 * Contract: /v1/survey — public prospect and partner surveys, throttled per IP.
 */
export const buildSurveyRouter = ({
  prospect = ProspectSurveyForm,
  partner = PartnerSurveyForm,
} = {}) => {
  const router = express.Router();

  router.post(
    '/submit',
    rateLimit({ name: 'survey-submit', windowMs: 10 * 60 * 1000, max: 10 }),
    validateBodyInPlace(ProspectSurveySchema),
    prospect,
  );
  router.post(
    '/partners',
    rateLimit({ name: 'survey-partners', windowMs: 10 * 60 * 1000, max: 10 }),
    validateBodyInPlace(PartnerSurveySchema),
    partner,
  );

  return router;
};

export default buildSurveyRouter();
