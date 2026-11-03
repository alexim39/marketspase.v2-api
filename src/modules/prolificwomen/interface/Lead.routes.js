import express from 'express';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { sendSuccess } from '../../../shared/http/sendSuccess.js';
import { validate } from '../../../shared/http/validate.js';
import { SubmitLeadUseCase } from '../application/SubmitLead.usecase.js';
import { MongoProlificWomanLeadRepository } from '../infrastructure/Lead.mongo.repository.js';
import { SubmitLeadSchema } from './Lead.validator.js';

export const buildProlificWomanLeadRouter = ({ leads, submit } = {}) => {
  const repository = leads ?? new MongoProlificWomanLeadRepository();
  const submitLead = submit ?? new SubmitLeadUseCase({ leads: repository });
  const router = express.Router();
  const submitLimit = rateLimit({
    name: 'prolificwoman-lead-submit',
    windowMs: 10 * 60 * 1000,
    max: 10,
  });

  router.post(
    '/leads',
    submitLimit,
    validate({ body: SubmitLeadSchema }),
    asyncHandler(async (req, res) => {
      const body = req.validated?.body ?? req.body;
      const lead = await submitLead.execute(body);
      return sendSuccess(res, {
        statusCode: 201,
        message: 'Application received',
        data: { id: lead.id, createdAt: lead.createdAt },
      });
    }),
  );

  return router;
};

export default buildProlificWomanLeadRouter();
