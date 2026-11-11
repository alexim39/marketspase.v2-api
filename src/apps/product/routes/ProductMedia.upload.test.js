import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PRODUCT_MEDIA_BYTES,
  PRODUCT_IMAGE_MIMES,
  PRODUCT_VIDEO_MIMES,
  productMediaFileFilter,
} from './ProductMedia.upload.js';

const check = (mimetype) => new Promise((resolve) => {
  productMediaFileFilter({}, { mimetype }, (error, accepted) => resolve({ error, accepted }));
});

describe('product media upload filter', () => {
  it('accepts product images and videos', async () => {
    for (const mime of [...PRODUCT_IMAGE_MIMES, ...PRODUCT_VIDEO_MIMES]) {
      const result = await check(mime);
      assert.equal(result.error, null, mime);
      assert.equal(result.accepted, true, mime);
    }
  });

  it('rejects unrelated files', async () => {
    const result = await check('application/pdf');
    assert.ok(result.error);
    assert.equal(result.accepted, undefined);
  });

  it('allows up to 50 MB so short product videos fit', () => {
    assert.equal(MAX_PRODUCT_MEDIA_BYTES, 50 * 1024 * 1024);
  });
});
