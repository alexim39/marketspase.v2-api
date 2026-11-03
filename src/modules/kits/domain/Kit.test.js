import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KIT_AREAS, createSlide, createSlides } from './Kit.js';

describe('Kit slides', () => {
  it('accepts a well-formed slide with optional visual and note', async () => {
    assert.deepEqual(createSlide({ title: 'The story', body: 'Once upon a team…' }), {
      title: 'The story', body: 'Once upon a team…',
    });
    assert.deepEqual(
      createSlide({ title: 'T', body: 'B', imageUrl: 'https://x/y.png', note: 'Pause here' }),
      { title: 'T', body: 'B', imageUrl: 'https://x/y.png', note: 'Pause here' },
    );
  });

  it('rejects empty titles, empty bodies and non-objects', async () => {
    await assert.rejects(async () => createSlide({ title: '', body: 'B' }), /slide title/);
    await assert.rejects(async () => createSlide({ title: 'T', body: '  ' }), /slide body/);
    await assert.rejects(async () => createSlide(null), /Invalid slide/);
  });

  it('requires at least one slide and caps the deck', async () => {
    const one = [{ title: 'T', body: 'B' }];
    assert.equal(createSlides(one).length, 1);
    await assert.rejects(async () => createSlides([]), /at least one slide/);
    await assert.rejects(
      async () => createSlides(Array.from({ length: 31 }, () => ({ title: 'T', body: 'B' }))),
      /at most 30 slides/,
    );
  });

  it('declares the four selling moments', async () => {
    assert.deepEqual(KIT_AREAS, ['Opportunity', 'Product', 'Invite', 'Team']);
  });
});
