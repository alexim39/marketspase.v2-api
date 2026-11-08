import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { rateLimit } from '../../../shared/http/rateLimit.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { ConflictException } from '../../../shared/domain/AppError.js';
import { GetPublicLandingUseCase, SubmitPublicLeadUseCase } from '../application/Pages.usecases.js';

const UsernameParam = z.object({
  username: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/, 'Invalid page'),
});

const LeadSchema = z.object({
  name: z.string().trim().min(2).max(80),
  surname: z.string().trim().max(80).optional().default(''),
  phone: z.string().trim().min(7).max(20),
  email: z.string().trim().email().max(254).optional().or(z.literal('')).default(''),
  state: z.string().trim().max(80).optional().default(''),
  message: z.string().trim().max(1000).optional().default(''),
});

/**
 * Public personal lead page API. This is intentionally unauthenticated:
 * it exposes only the fields a partner chose to publish and accepts opt-in
 * lead submissions into that partner's pipeline.
 */
export const buildPublicPagesRouter = (deps = {}) => {
  const router = express.Router();
  const landing = deps.landing ?? new GetPublicLandingUseCase({});
  const submit = deps.submit ?? new SubmitPublicLeadUseCase({});

  router.get(
    '/:username',
    validate({ params: UsernameParam }),
    asyncHandler(async (req, res) => {
      const data = await landing.execute({ username: req.validated.params.username });
      res.status(200).json({ message: 'Page retrieved successfully', data, success: true });
    }),
  );

  router.post(
    '/:username/leads',
    rateLimit({ name: 'public-page-lead', windowMs: 10 * 60 * 1000, max: 10 }),
    validate({ params: UsernameParam, body: LeadSchema }),
    asyncHandler(async (req, res) => {
      try {
        const data = await submit.execute({
          username: req.validated.params.username,
          lead: req.validated.body,
        });
        res.status(201).json({
          message: 'Thanks — your details are with the team.',
          data: { id: String(data?.id ?? data?._id ?? '') },
          success: true,
        });
      } catch (error) {
        // A repeat submission is not an error to the visitor.
        if (error instanceof ConflictException || error?.statusCode === 409) {
          return res.status(200).json({
            message: 'Your details are already with this team. They will reach out.',
            data: { already: true },
            success: true,
          });
        }
        throw error;
      }
    }),
  );

  return router;
};

export default buildPublicPagesRouter();
