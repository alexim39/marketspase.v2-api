import path from 'node:path';
import { promises as fs } from 'node:fs';
import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { publicIdFromUrl } from '../infrastructure/CloudinaryClient.js';

/** Legacy on-disk photo dir (pre-Cloudinary rows hold bare filenames). */
export const LEGACY_UPLOADS_DIR = path.join('src', 'uploads');

const defaultRemoveFile = (filename) =>
  fs.unlink(path.join(LEGACY_UPLOADS_DIR, path.basename(filename))).catch(() => null);

/**
 * Profile photo upload: Cloudinary → partner.profileImage URL.
 * Session identity owns the write — no :userId to tamper with (legacy
 * trusted a URL param, so anyone could overwrite anyone's photo).
 * The previous image is removed afterwards (Cloudinary destroy, or
 * legacy disk unlink) so storage never holds redundancies — cleanup is
 * best-effort and can never fail the upload.
 */
export class UploadProfileImageUseCase {
  /** @param {{images, partners, removeFile?}} deps */
  constructor({ images, partners, removeFile = null }) {
    Object.assign(this, { images, partners });
    this.removeFile = removeFile ?? defaultRemoveFile;
  }

  async execute({ partnerId, buffer }) {
    if (!buffer || buffer.length === 0) throw new ValidationException('No image uploaded');
    const exists = await this.partners.findById(partnerId);
    if (!exists) throw new NotFoundException('Partner not found');
    const previous = exists.profileImage ?? null;
    const safeId = String(partnerId).replace(/[^a-fA-F0-9]/g, '');
    const { url } = await this.images.upload(buffer, {
      publicId: `partner-${safeId || 'anon'}-${Date.now()}`,
    });
    await this.partners.updateById(partnerId, { profileImage: url });
    if (previous && previous !== url) {
      try {
        const publicId = publicIdFromUrl(previous);
        if (publicId) await this.images.destroy(publicId);
        else await this.removeFile(previous);
      } catch (error) {
        console.warn(`[settings] previous photo cleanup failed: ${error?.message ?? error}`);
      }
    }
    return { url };
  }
}
