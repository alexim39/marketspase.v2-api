import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { validate } from '../../../shared/http/validate.js';
import { ValidationException } from '../../../shared/domain/AppError.js';
import { env } from '../../../shared/config/env.js';
import { UploadProfileImageUseCase } from '../application/ProfileImage.usecase.js';
import { buildImageStore } from '../infrastructure/CloudinaryClient.js';
import { profileImageUpload } from './ProfileImage.upload.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';
import { DraftModel } from '../infrastructure/Draft.mongo.model.js';

const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DraftKey = z.object({ key: z.string().trim().regex(/^[a-zA-Z0-9._:-]{3,80}$/, 'Invalid draft key') });
const DraftBody = z.object({
  payload: z.unknown(),
  path: z.string().trim().max(300).optional().default(null),
});

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildSettingsRouter = (deps = {}) => {
  const partners = deps.partners ?? new MongoPartnerRepository();
  const images = deps.images ?? buildImageStore(env.cloudinary);
  const uploadPhoto = deps.uploadPhoto ?? new UploadProfileImageUseCase({ images, partners });

  const router = express.Router();
  // Session identity owns the photo — legacy trusted a :userId URL param.
  router.use(requireAuth);

  router.get(
    '/drafts/:key',
    validate({ params: DraftKey }),
    asyncHandler(async (req, res) => {
      const doc = await DraftModel.findOne({
        partnerId: req.auth?.partnerId,
        key: req.validated.params.key,
      }).lean();
      res.status(200).json({
        message: 'Draft retrieved',
        success: true,
        data: doc ? {
          key: doc.key,
          payload: doc.payload,
          path: doc.path ?? null,
          updatedAt: doc.updatedAt ?? null,
        } : null,
      });
    }),
  );

  router.put(
    '/drafts/:key',
    validate({ params: DraftKey, body: DraftBody }),
    asyncHandler(async (req, res) => {
      const { payload, path } = req.validated.body;
      const size = Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8');
      if (size > 100 * 1024) throw new ValidationException('Draft is too large to save');
      const expiresAt = new Date(Date.now() + DRAFT_TTL_MS);
      const doc = await DraftModel.findOneAndUpdate(
        { partnerId: req.auth?.partnerId, key: req.validated.params.key },
        {
          $set: {
            payload,
            path,
            expiresAt,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();
      res.status(200).json({
        message: 'Draft saved',
        success: true,
        data: { key: doc.key, updatedAt: doc.updatedAt ?? null },
      });
    }),
  );

  router.delete(
    '/drafts/:key',
    validate({ params: DraftKey }),
    asyncHandler(async (req, res) => {
      await DraftModel.deleteOne({ partnerId: req.auth?.partnerId, key: req.validated.params.key });
      res.status(200).json({ message: 'Draft cleared', success: true, data: { cleared: true } });
    }),
  );

  router.post(
    '/profile-image',
    profileImageUpload.single('image'),
    asyncHandler(async (req, res) => {
      const data = await uploadPhoto.execute({
        partnerId: req.auth?.partnerId,
        buffer: req.file?.buffer,
      });
      res.status(200).json({ message: 'Profile picture updated successfully', data, success: true });
    }),
  );

  return router;
};

export default buildSettingsRouter();
