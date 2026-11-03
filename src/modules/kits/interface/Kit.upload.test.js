import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { kitFileFilter, assertPdfBuffer, DECK_MAX_BYTES } from './Kit.upload.js';

const file = (over = {}) => ({ originalname: 'deck.pdf', mimetype: 'application/pdf', ...over });
const runFilter = (f) => new Promise((resolve, reject) => {
  kitFileFilter(null, f, (err, ok) => (err ? reject(err) : resolve(ok)));
});

describe('kitFileFilter', () => {
  it('accepts PDFs by mimetype or extension', async () => {
    assert.equal(await runFilter(file()), true);
    assert.equal(await runFilter(file({ mimetype: 'application/octet-stream' })), true);
  });

  it('rejects PowerPoint and friends with the export guidance', async () => {
    await assert.rejects(
      runFilter(file({ originalname: 'deck.pptx', mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })),
      /Create PDF/,
    );
    await assert.rejects(runFilter(file({ originalname: 'photo.png', mimetype: 'image/png' })), /Only PDF/);
  });

  it('caps decks at 25MB', async () => {
    assert.equal(DECK_MAX_BYTES, 25 * 1024 * 1024);
  });
});

describe('assertPdfBuffer', () => {
  it('requires the %PDF- magic', async () => {
    assert.doesNotThrow(() => assertPdfBuffer(Buffer.from('%PDF-1.7 rest')));
    assert.throws(() => assertPdfBuffer(null), /No PDF received/);
    assert.throws(() => assertPdfBuffer(Buffer.from('PK\x03\x04zip')), /Not a valid PDF/);
  });
});
