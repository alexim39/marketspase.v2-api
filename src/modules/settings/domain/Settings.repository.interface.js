/**
 * Contracts for the settings slice (member profile management).
 * The image store is a port — Cloudinary in production, fakes in tests.
 */
export class ImageStore {
  /** @param {Buffer} buffer @param {{folder, publicId}} opts @returns {Promise<{url}>} */
  async upload(buffer, opts) { throw new Error('Not implemented'); }
}
