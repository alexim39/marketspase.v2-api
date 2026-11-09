import express from 'express';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
import { ProspectSurveyForm } from '../controllers/survey.controller.js';
import { ProspectSurveySchema } from './Survey.validator.js';

/**
 * Contract: /v1/survey — public prospect survey, throttled per IP.
 * Partner surveys were retired with their admin desk.
 */
export const buildSurveyRouter = ({
  prospect = ProspectSurveyForm,
} = {}) => {
  const router = express.Router();

  router.post(
    '/submit',
    rateLimit({ name: 'survey-submit', windowMs: 10 * 60 * 1000, max: 10 }),
    validateBodyInPlace(ProspectSurveySchema),
    prospect,
  );

  return router;
};

export default buildSurveyRouter();
