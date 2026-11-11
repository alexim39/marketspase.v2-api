import multer from 'multer';
import { ValidationException } from '../../../shared/domain/AppError.js';

/** Product media: images and short videos. Per-kind size checks live in the controller. */
export const PRODUCT_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
];
export const PRODUCT_VIDEO_MIMES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
];
export const PRODUCT_MEDIA_MIMES = [...PRODUCT_IMAGE_MIMES, ...PRODUCT_VIDEO_MIMES];
export const MAX_PRODUCT_MEDIA_BYTES = 50 * 1024 * 1024;

export function productMediaFileFilter(_req, file, cb) {
  if (PRODUCT_MEDIA_MIMES.includes(file?.mimetype)) return cb(null, true);
  return cb(new ValidationException(
    `Only product images or videos are allowed (${PRODUCT_MEDIA_MIMES.join(', ')})`,
  ));
}

export const productMediaUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: productMediaFileFilter,
  limits: { fileSize: MAX_PRODUCT_MEDIA_BYTES, files: 1 },
});
