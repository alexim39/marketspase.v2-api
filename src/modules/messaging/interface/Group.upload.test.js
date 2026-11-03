import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_PHOTO_MAX_BYTES, groupPhotoFileFilter } from './Group.upload.js';

const decide = (file) => new Promise((resolve, reject) => {
  groupPhotoFileFilter({}, file, (err, ok) => (err ? reject(err) : resolve(ok)));
});

describe('group photo upload filter', () => {
  it('caps avatars at 5MB', () => {
    assert.equal(GROUP_PHOTO_MAX_BYTES, 5 * 1024 * 1024);
  });

  it('accepts jpeg, png and webp by mime or extension', async () => {
    assert.equal(await decide({ mimetype: 'image/jpeg', originalname: 'a.jpg' }), true);
    assert.equal(await decide({ mimetype: 'image/png', originalname: 'a.png' }), true);
    assert.equal(await decide({ mimetype: 'image/webp', originalname: 'a.webp' }), true);
    assert.equal(await decide({ mimetype: '', originalname: 'a.png' }), true);
  });

  it('rejects anything else with a domain error', async () => {
    await assert.rejects(decide({ mimetype: 'image/gif', originalname: 'a.gif' }), /JPEG, PNG or WebP/);
    await assert.rejects(decide({ mimetype: 'video/mp4', originalname: 'a.mp4' }), /JPEG, PNG or WebP/);
    await assert.rejects(decide({ mimetype: '', originalname: 'a.bmp' }), /JPEG, PNG or WebP/);
  });
});
