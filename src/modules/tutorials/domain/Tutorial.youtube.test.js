import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIAL_AREAS, embedUrl, extractYouTubeId, thumbnailUrl } from './Tutorial.youtube.js';

test('extractYouTubeId accepts all YouTube shapes', () => {
  assert.equal(extractYouTubeId('M1pueeOSTrc'), 'M1pueeOSTrc');
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=M1pueeOSTrc'), 'M1pueeOSTrc');
  assert.equal(extractYouTubeId('https://youtube.com/watch?v=M1pueeOSTrc&t=30s'), 'M1pueeOSTrc');
  assert.equal(extractYouTubeId('https://youtu.be/M1pueeOSTrc'), 'M1pueeOSTrc');
  assert.equal(extractYouTubeId('https://www.youtube.com/shorts/M1pueeOSTrc'), 'M1pueeOSTrc');
  assert.equal(extractYouTubeId('https://www.youtube.com/embed/M1pueeOSTrc'), 'M1pueeOSTrc');
});

test('extractYouTubeId rejects non-YouTube input', () => {
  assert.equal(extractYouTubeId(''), null);
  assert.equal(extractYouTubeId('not a url'), null);
  assert.equal(extractYouTubeId('https://vimeo.com/12345'), null);
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=short'), null);
});

test('embed uses nocookie and thumbnails resolve', () => {
  assert.equal(embedUrl('M1pueeOSTrc'), 'https://www.youtube-nocookie.com/embed/M1pueeOSTrc?rel=0');
  assert.equal(thumbnailUrl('M1pueeOSTrc'), 'https://i.ytimg.com/vi/M1pueeOSTrc/hqdefault.jpg');
});

test('tutorial areas cover the platform flows', () => {
  assert.deepEqual(TUTORIAL_AREAS, ['Start', 'Prospects', 'Sessions', 'Wallet', 'Team', 'Grow']);
});
