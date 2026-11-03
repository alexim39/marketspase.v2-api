import multer from 'multer';
import { ValidationException } from '../../../shared/domain/AppError.js';

/**
 * Group avatars ride multer memory storage straight into the image
 * store (Cloudinary — same pattern as profile photos and community
 * media). Nothing touches local disk, so uploads survive deploys and
 * multi-server setups.
 */

/** Group avatar cap — avatars stay small; 5MB matches community images. */
export const GROUP_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const GROUP_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

/** Exported for unit tests — rejects non-image uploads with a domain error. */
export function groupPhotoFileFilter(_req, file, cb) {
  const type = String(file?.mimetype ?? '');
  const name = String(file?.originalname ?? '');
  if (GROUP_PHOTO_MIMES.includes(type)) return cb(null, true);
  if (!type && /\.(jpe?g|png|webp)$/i.test(name)) return cb(null, true);
  return cb(new ValidationException(`Only JPEG, PNG or WebP images are allowed (${GROUP_PHOTO_MIMES.join(', ')})`));
}

/** Single-photo upload: `photo` field, 5MB transport cap. Multer size errors map to 400 in errorMiddleware. */
export const groupPhotoUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: groupPhotoFileFilter,
  limits: { fileSize: GROUP_PHOTO_MAX_BYTES, files: 1 },
});
