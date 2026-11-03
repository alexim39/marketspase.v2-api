import multer from 'multer';
import { ValidationException } from '../../../shared/domain/AppError.js';
import { ATTACHMENT_MIMES, MAX_ATTACHMENT_BYTES } from '../domain/Post.entity.js';

/**
 * Community media rides multer memory storage straight into the media
 * store (Cloudinary — same pattern as profile photos). Images use the
 * default image resource type; videos are uploaded as `video` assets.
 * Nothing touches local disk, so uploads survive deploys and
 * multi-server setups. Kept export for compat — no longer a write target.
 */
export const COMMUNITY_UPLOAD_DIR = 'community';

/** Exported for unit tests — rejects non-image/video uploads with a domain error. */
export function communityFileFilter(_req, file, cb) {
  const type = String(file?.mimetype ?? '');
  const name = String(file?.originalname ?? '');
  if (ATTACHMENT_MIMES.includes(type)) return cb(null, true);
  if (!type && (/\.(jpe?g|png|webp|gif|mp4|webm|mov)$/i.test(name))) return cb(null, true);
  return cb(new ValidationException(`Only images and videos are allowed (${ATTACHMENT_MIMES.join(', ')})`));
}

/** Single-media upload: `media` field, 100MB transport cap. Multer size errors map to 400 in errorMiddleware. */
export const communityUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: communityFileFilter,
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
});
