import express from 'express';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { env } from '../../../shared/config/env.js';
import { UploadProfileImageUseCase } from '../application/ProfileImage.usecase.js';
import { buildImageStore } from '../infrastructure/CloudinaryClient.js';
import { profileImageUpload } from './ProfileImage.upload.js';
import { MongoPartnerRepository } from '../../identity-access/infrastructure/Auth.mongo.repository.js';

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildSettingsRouter = (deps = {}) => {
  const partners = deps.partners ?? new MongoPartnerRepository();
  const images = deps.images ?? buildImageStore(env.cloudinary);
  const uploadPhoto = deps.uploadPhoto ?? new UploadProfileImageUseCase({ images, partners });

  const router = express.Router();
  // Session identity owns the photo — legacy trusted a :userId URL param.
  router.use(requireAuth);

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
