import express from 'express';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { 
    ProspectSurveyForm,
    PartnerSurveyForm
} from '../controllers/survey.controller.js'
const SurveyRouter = express.Router();

// Public forms — throttled per IP against survey spam.
// prospet user survey
SurveyRouter.post('/submit', rateLimit({ name: 'survey-submit', windowMs: 10 * 60 * 1000, max: 10 }), ProspectSurveyForm);
// partner user survey
SurveyRouter.post('/partners', rateLimit({ name: 'survey-partners', windowMs: 10 * 60 * 1000, max: 10 }), PartnerSurveyForm);


export default SurveyRouter;
