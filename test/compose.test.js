import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { compose, safeLink, titleFrom } from '../src/compose.js';
import { exportDay } from '../src/export.js';
import { combinePalettes, measureMusic } from '../src/media.js';

const text = 'Neon on the walk home. Rain hit the pavement like a drum.';
const photo = { color: [36, 119, 153], light: 0.48 };
const calm = { bpm: 62, energy: 0.25 };
const fast = { bpm: 145, energy: 0.84 };

function scene(music, changes = {}) {
  return compose({ text, photo, music, photoCount: 2, ...changes });
}

test('soundtrack changes timing, motion and grade with text and photos fixed', () => {
  const slowScene = scene(calm);
  const fastScene = scene(fast);
  assert.equal(slowScene.title, fastScene.title);
  assert.equal(slowScene.mood, fastScene.mood);
  assert.ok(slowScene.seconds > fastScene.seconds);
  assert.ok(slowScene.crossfade > fastScene.crossfade);
  assert.ok(slowScene.zoom < fastScene.zoom);
  assert.ok(slowScene.saturation < fastScene.saturation);
  assert.equal(fastScene.motion, 'pulse');
});

test('text and photo contribute separately to the same scene grammar', () => {
  const original = scene(calm);
  const differentStory = scene(calm, { text: 'Quiet coffee in the mist. We watched the soft rain.' });
  const differentPhoto = scene(calm, { photo: { color: [201, 124, 37], light: 0.68 } });
  assert.equal(differentStory.mood, 'still');
  assert.notEqual(original.title, differentStory.title);
  assert.deepEqual(original.phrase, 'Rain hit the pavement like a drum.');
  assert.notDeepEqual(original.accent, differentPhoto.accent);
  assert.notEqual(original.brightness, differentPhoto.brightness);
  assert.equal(original.crossfade, differentPhoto.crossfade);
  assert.equal(scene(fast, { photoCount: 6 }).shotCount, 6);
  assert.deepEqual(scene(calm, { text: 'Slow morning at home. The rain stopped. We heard the birds again.' }).captions,
    ['The rain stopped.', 'We heard the birds again.']);
});

test('titles use the story and handle short entries in both languages', () => {
  assert.equal(titleFrom(text), 'Neon on the walk home');
  assert.equal(titleFrom('Туман.'), 'День про Туман');
  assert.equal(titleFrom('Quiet.'), 'A day with Quiet');
  assert.equal(titleFrom('Утром тихий лес раскрылся перед нами.'), 'Тихий лес раскрылся перед нами');
  assert.equal(titleFrom('First second third fourth fifth sixth seventh eighth.'), 'First second third fourth fifth sixth seventh');
});

test('audio measurement distinguishes slow and fast pulses and handles silence', () => {
  const sampleRate = 22050;
  const pulse = (bpm, amplitude) => Float32Array.from({ length: sampleRate * 14 }, (_, index) => {
    const time = index / sampleRate;
    const beat = time * bpm / 60;
    const phase = beat - Math.floor(beat);
    return phase < 0.12 ? amplitude * Math.sin(time * Math.PI * 110) * Math.exp(-phase * 12) : 0;
  });
  const slowSong = measureMusic(pulse(60, 0.2), sampleRate);
  const fastSong = measureMusic(pulse(132, 0.5), sampleRate);
  assert.ok(Math.abs(slowSong.bpm - 60) <= 2);
  assert.ok(Math.abs(fastSong.bpm - 132) <= 3);
  assert.ok(fastSong.energy > slowSong.energy);
  assert.deepEqual(measureMusic(new Float32Array(sampleRate * 3), sampleRate), { bpm: null, energy: 0 });
});

test('linked songs accept HTTPS without credentials', () => {
  assert.equal(safeLink('https://example.org/track'), 'https://example.org/track');
  assert.throws(() => safeLink('javascript:alert(1)'));
  assert.throws(() => safeLink('https://user:pass@example.org/track'));
});

test('first photo contributes twice to the cover palette', () => {
  assert.deepEqual(combinePalettes([photo, { color: [201, 124, 37], light: 0.78 }]), { color: [91, 121, 114], light: 0.58 });
});

test('export preserves input files and escapes journal text in the offline player', async () => {
  const hostile = 'Quiet at the window. <script>alert(1)</script>';
  const date = '2026-11-22';
  const music = { ...calm, source: 'link', link: 'https://example.org/track?a=1&b=2' };
  const day = {
    date, music, text: hostile, photo,
    photos: [{ name: 'original.webp', blob: new Blob(['photo bytes'], { type: 'image/webp' }) }],
    design: scene(music, { text: hostile, photoCount: 1 }),
  };
  const exported = await exportDay(day);
  const folder = `${date} Quiet at the window`;
  const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
  assert.equal(exported.name, `${folder}.zip`);
  assert.equal(strFromU8(files[`${folder}/entry.txt`]), hostile);
  assert.equal(strFromU8(files[`${folder}/photo-01.webp`]), 'photo bytes');
  assert.equal(strFromU8(files[`${folder}/song-link.txt`]), music.link);
  const player = strFromU8(files[`${folder}/memory.html`]);
  assert.match(player, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(player, /<script>alert\(1\)<\/script>/);
  assert.match(player, /https:\/\/example\.org\/track\?a=1&amp;b=2/);
});
