import { v2 as cloudinary } from 'cloudinary';

/**
 * Cloudinary image/video asset store (profile photos, store branding and
 * product media). Credentials come from env at construction and are never
 * logged — only the folder/public-id (non-secrets) appear in errors. Uploads
 * go to `folder` with a server-generated public id (never the client
 * filename). Inject `sdk` in tests.
 */
export class ImageStore {
  async upload() { throw new Error('Not implemented'); }
  async destroy() { throw new Error('Not implemented'); }
}

/**
 * Reverse a Cloudinary delivery URL to its public id:
 * `…/upload/(v123/)folder/name.png` → `folder/name`.
 * Returns null for anything else (legacy filenames, blanks) so callers
 * never send garbage to the API.
 */
export const publicIdFromUrl = (url) => {
  const m = /\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:[?#].*)?$/.exec(String(url ?? '').trim());
  if (!m) return null;
  const id = m[1].trim();
  return id && !/\s/.test(id) ? id : null;
};

/**
 * Cloudinary video poster: insert a first-frame transformation and swap the
 * extension. Returns the original URL if it is not a video delivery URL.
 */
export const videoPosterUrl = (url) => {
  const value = String(url ?? '').trim();
  if (!value.includes('/video/upload/')) return '';
  const transformed = value.replace(
    '/video/upload/',
    '/video/upload/so_0,w_1200,h_1200,c_fill,q_auto,f_jpg/',
  );
  return transformed.replace(/\.(mp4|webm|mov|avi|mkv|m3u8)(?:[?#].*)?$/i, '.jpg');
};

export class CloudinaryImageStore extends ImageStore {
  /** @param {{cloudName, apiKey, apiSecret, folder, resourceType?, label?, sdk?}} config */
  constructor(config = {}) {
    super();
    this.folder = config.folder || 'diamond-projects';
    // Upload kind (images by default; decks use 'auto' for PDFs).
    this.resourceType = config.resourceType || 'image';
    this.label = config.label || 'Image';
    this.sdk = config.sdk ?? cloudinary;
    if (!config.sdk) {
      this.sdk.config({
        cloud_name: config.cloudName,
        api_key: config.apiKey,
        api_secret: config.apiSecret,
        secure: true,
      });
    }
  }

  async upload(buffer, { publicId, resourceType } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error(`Empty ${this.label.toLowerCase()} upload`);
    const rt = resourceType ?? this.resourceType;
    const sdk = this.sdk;
    // Single-request uploads can hit provider payload limits (HTTP 413) on
    // large videos, so stream big buffers in 20MB chunks instead.
    const chunked = buffer.length > 10 * 1024 * 1024 && typeof sdk.uploader?.upload_chunked_stream === 'function';
    return new Promise((resolve, reject) => {
      const done = (error, result) => {
        if (error) return reject(new Error(`${this.label} upload failed: ${error?.message ?? 'unknown error'}`));
        if (!result?.secure_url) return reject(new Error(`${this.label} upload returned no URL`));
        const video = (result.resource_type ?? rt) === 'video';
        const thumbnailUrl = video ? videoPosterUrl(result.secure_url) : result.secure_url;
        resolve({
          url: result.secure_url,
          publicId: result.public_id ?? null,
          width: Number.isFinite(Number(result.width)) ? Number(result.width) : null,
          height: Number.isFinite(Number(result.height)) ? Number(result.height) : null,
          duration: Number.isFinite(Number(result.duration)) ? Number(result.duration) : null,
          format: result.format ?? null,
          resourceType: result.resource_type ?? rt,
          thumbnailUrl,
        });
      };
      const stream = chunked
        ? sdk.uploader.upload_chunked_stream(
          { folder: this.folder, public_id: publicId, resource_type: rt, chunk_size: 20 * 1024 * 1024 },
          done,
        )
        : sdk.uploader.upload_stream(
          { folder: this.folder, public_id: publicId, resource_type: rt },
          done,
        );
      stream.end(buffer);
    });
  }

  /** Delete one asset by public id — `not found` counts as deleted. */
  async destroy(publicId, { resourceType } = {}) {
    if (!publicId) return { deleted: false };
    try {
      const result = await this.sdk.uploader.destroy(publicId, { resource_type: resourceType ?? this.resourceType });
      return { deleted: result?.result === 'ok' || result?.result === 'not found' };
    } catch (error) {
      throw new Error(`${this.label} delete failed: ${error?.message ?? 'unknown error'}`);
    }
  }
}

export class DisabledImageStore extends ImageStore {
  async upload() {
    const error = new Error('Image uploads are not configured yet');
    error.statusCode = 503;
    error.code = 'CLOUDINARY_NOT_CONFIGURED';
    throw error;
  }

  async destroy() {
    return { deleted: false };
  }
}

/** Factory — real store only when all three credentials exist. */
export const buildImageStore = (cloudinaryEnv = {}) => (
  cloudinaryEnv.enabled
    ? new CloudinaryImageStore(cloudinaryEnv)
    : new DisabledImageStore()
);
