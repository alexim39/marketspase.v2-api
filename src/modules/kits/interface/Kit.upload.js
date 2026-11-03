import multer from 'multer';
import { ValidationException } from '../../../shared/domain/AppError.js';

/**
 * Deck PDF uploads — multer memory storage straight into the deck store
 * (Cloudinary, same deploy-proof pattern as profile/community images).
 * PowerPoint files are NOT accepted: less than full fidelity in-browser,
 * so admins export once (File → Export → Create PDF) and upload the PDF.
 */
export const DECK_MAX_BYTES = 25 * 1024 * 1024;
export const DECK_HELP = 'Only PDF decks are allowed — in PowerPoint: File → Export → Create PDF, then upload the PDF.';

/** Exported for unit tests — rejects non-PDFs with a domain error. */
export function kitFileFilter(_req, file, cb) {
  const name = String(file?.originalname ?? '');
  const ok = file?.mimetype === 'application/pdf' || /\.pdf$/i.test(name);
  if (ok) return cb(null, true);
  return cb(new ValidationException(DECK_HELP));
}

/** Single-deck upload: `deck` field, 25MB cap. Multer size errors map to 400 in errorMiddleware. */
export const kitUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: kitFileFilter,
  limits: { fileSize: DECK_MAX_BYTES, files: 1 },
});

/** Magic-byte check on the buffered upload (mimetypes are client-asserted). */
export function assertPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    throw new ValidationException('No PDF received');
  }
  if (buffer.subarray(0, 5).toString('binary') !== '%PDF-') {
    throw new ValidationException('Not a valid PDF file');
  }
}
