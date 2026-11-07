import multer from 'multer';
import { ValidationException } from '../../../shared/domain/AppError.js';

/** Store brand images: images only, 5MB cap. */
export const STORE_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_STORE_IMAGE_BYTES = 5 * 1024 * 1024;

export function storeImageFileFilter(_req, file, cb) {
  if (STORE_IMAGE_MIMES.includes(file?.mimetype)) return cb(null, true);
  return cb(new ValidationException(`Only images are allowed (${STORE_IMAGE_MIMES.join(', ')})`));
}

/** Memory upload — the buffer streams to Cloudinary, never local disk. */
export const storeImageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: storeImageFileFilter,
  limits: { fileSize: MAX_STORE_IMAGE_BYTES, files: 1 },
});
