import multer from 'multer';
import { ValidationException } from '../../../shared/domain/AppError.js';

/** Profile photos: images only, 5MB cap (mirrors community attachments). */
export const PROFILE_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Exported for unit tests — rejects non-images with a domain error. */
export function profileImageFileFilter(_req, file, cb) {
  if (PROFILE_IMAGE_MIMES.includes(file?.mimetype)) return cb(null, true);
  return cb(new ValidationException(`Only images are allowed (${PROFILE_IMAGE_MIMES.join(', ')})`));
}

/**
 * Memory upload: the buffer streams straight to Cloudinary — nothing
 * touches local disk (legacy wrote `src/uploads/` and was bound to one
 * server's filesystem). Multer size errors map to 400 in errorMiddleware.
 */
export const profileImageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: profileImageFileFilter,
  limits: { fileSize: MAX_PROFILE_IMAGE_BYTES, files: 1 },
});
