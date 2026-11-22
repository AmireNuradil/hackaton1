import assert from 'node:assert/strict';
import test from 'node:test';
import { describedMusic } from '../src/music.js';
import { buildDay } from '../src/pipeline.js';
import { TECHNIQUES } from '../src/system.js';

const photo = { palette: [[180, 120, 80], [60, 50, 40], [220, 200, 170]], weights: [0.5, 0.3, 0.2], light: 0.5, contrast: 0.2, warmth: 0.2, saturation: 0.4 };
const photos = [{ name: 'a.jpg' }];
const music = (pace, energy, mode, extra = {}) => ({ source: 'link', link: 'https://example.org/song', name: 'example.org', ...describedMusic({ pace, energy, mode, ...extra }) });
const day = (text, song, date = '2026-10-12') => buildDay({ id: 'test', date, text, photos, photoReadings: [photo], music: song, created: 1 });

const calm = 'Тихий тёплый вечер у пруда, пили какао, было уютно и спокойно.';
const tense = 'Ночь в офисе перед сдачей, срочно, нервы, шум.';

test('each mood quadrant gets its own technique', () => {
  assert.equal(day(calm, music('slow', 'soft', 'major')).design.technique, 'monet');
  assert.equal(day('Весь день на пляже с друзьями! Смеялись, танцевали, было весело.', music('fast', 'full', 'major')).design.technique, 'seurat');
  assert.equal(day(tense, music('fast', 'intense', 'minor', { genre: 'electronic' })).design.technique, 'kandinsky');
  assert.equal(day('Ехала одна в автобусе под дождём. Было пусто и грустно.', music('slow', 'soft', 'minor')).design.technique, 'ma');
  assert.equal(day('Помню, как в детстве ездили к бабушке на дачу.', music('medium', 'soft', 'major', { year: 1975 })).design.technique, 'film');
});

test('the song changes the page while words and photos stay fixed', () => {
  const slow = day(calm, music('slow', 'soft', 'major')).design;
  const fast = day(calm, music('fast', 'intense', 'minor')).design;
  assert.equal(slow.title, fast.title);
  assert.deepEqual(slow.captions, fast.captions);
  assert.ok(slow.rhythm.sceneSeconds > fast.rhythm.sceneSeconds, 'faster song, shorter frames');
  assert.ok(slow.rhythm.transition > fast.rhythm.transition, 'faster song, quicker cuts');
  assert.ok(slow.motion.pulse < fast.motion.pulse, 'more energy, stronger pulse');
  assert.ok(fast.mood.valence < slow.mood.valence, 'minor key darkens the mood');
  assert.ok(slow.voice.rate < fast.voice.rate);
});

test('an old song adds film grain; frames land on whole beats', () => {
  const recent = day(calm, music('medium', 'soft', 'major', { year: 2024 })).design;
  const old = day(calm, music('medium', 'soft', 'major', { year: 1962 })).design;
  assert.ok(old.texture.grain > recent.texture.grain);
  const { beat, beatsPerScene, sceneSeconds, scenes, seconds } = recent.rhythm;
  assert.ok(Math.abs(sceneSeconds - beat * beatsPerScene) < 0.02);
  assert.ok(seconds >= 15 && seconds <= 45 && scenes >= 3);
});

test('photo colour feeds the palette', () => {
  const warm = day(calm, music('slow', 'soft', 'major')).design.palette[0];
  const cool = buildDay({ id: 'b', date: '2026-10-12', text: calm, photos, photoReadings: [{ ...photo, palette: [[40, 90, 170], ...photo.palette.slice(1)] }], music: music('slow', 'soft', 'major') }).design.palette[0];
  assert.ok(warm[0] > warm[2] && cool[2] > cool[0]);
});

test('every page explains itself, for every technique', () => {
  const design = day(tense, music('fast', 'intense', 'minor')).design;
  assert.deepEqual(design.reasons.map((reason) => reason.input).slice(0, 4), ['Текст', 'Фото', 'Музыка', 'Приём']);
  for (const technique of Object.values(TECHNIQUES)) assert.ok(technique.references && technique.why && technique.voice && technique.mood);
});

test('the same inputs always build the same page', () => {
  assert.deepEqual(day(calm, music('slow', 'soft', 'major')), day(calm, music('slow', 'soft', 'major')));
});

test('the explanation never contradicts the chosen technique', () => {
  for (const [text, song] of [
    ['Ничего не происходило.', { source: 'file', name: 'x', bpm: null, energy: 0, mode: null, key: null, keyConfidence: 0, brightness: 0 }],
    [calm, music('slow', 'soft', 'major')],
    [tense, music('fast', 'intense', 'minor')],
  ]) {
    const { technique, reasons, mood } = day(text, song).design;
    const cause = reasons.find((reason) => reason.input === 'Приём').cause;
    if (mood.nostalgia >= 0.5) continue;
    const bright = /светлое/.test(cause);
    assert.equal(bright, technique === 'monet' || technique === 'seurat', `${technique}: ${cause}`);
  }
});

test('on a borderline day the song alone can move the page into another technique', () => {
  const text = 'Ночь в офисе перед сдачей проекта. Кофе остыл, за окном неон.';
  const slow = day(text, music('slow', 'soft', 'major')).design;
  const fast = day(text, music('fast', 'intense', 'minor', { genre: 'electronic' })).design;
  assert.equal(slow.title, fast.title);
  assert.notEqual(slow.technique, fast.technique);
  assert.equal(fast.technique, 'kandinsky');
});

test('a lively song cuts quickly: more, shorter shots instead of stretched frames', () => {
  const lively = day('Весь день танцевали с друзьями, смеялись!', music('fast', 'intense', 'major')).design.rhythm;
  const quiet = day(calm, music('slow', 'soft', 'major')).design.rhythm;
  assert.ok(lively.sceneSeconds < 3.5, `${lively.sceneSeconds}s`);
  assert.ok(lively.scenes > quiet.scenes);
  assert.ok(lively.seconds >= 15 && lively.seconds <= 45);
});
