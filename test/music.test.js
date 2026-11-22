import assert from 'node:assert/strict';
import test from 'node:test';
import { describedMusic, detectKey, measureMusic } from '../src/music.js';

const rate = 22050;
function song(bpm, notes, beatLevel = 0.3, seconds = 14) {
  return Float32Array.from({ length: rate * seconds }, (_, i) => {
    const t = i / rate;
    const beat = t * bpm / 60;
    const phase = beat - Math.floor(beat);
    const chord = notes.reduce((sum, n) => sum + Math.sin(2 * Math.PI * 440 * 2 ** ((n - 69) / 12) * t), 0) / notes.length * 0.15;
    return chord + (phase < 0.12 ? beatLevel * Math.sin(t * Math.PI * 110) * Math.exp(-phase * 12) : 0);
  });
}

test('tempo is measured for slow and fast songs', () => {
  assert.ok(Math.abs(measureMusic(song(60, [60, 64, 67]), rate).bpm - 60) <= 2);
  assert.ok(Math.abs(measureMusic(song(132, [57, 60, 64]), rate).bpm - 132) <= 3);
});

test('major and minor chords are told apart', () => {
  const major = measureMusic(song(90, [60, 64, 67]), rate);
  const minor = measureMusic(song(90, [57, 60, 64]), rate);
  assert.equal(major.mode, 'major');
  assert.equal(major.key, 'C мажор');
  assert.equal(minor.mode, 'minor');
  assert.equal(minor.key, 'A минор');
});

test('a stronger beat reads as more energy', () => {
  assert.ok(measureMusic(song(120, [60, 64, 67], 0.9), rate).energy > measureMusic(song(120, [60, 64, 67], 0.1), rate).energy);
});

test('silence has no beat, key or energy', () => {
  assert.deepEqual(measureMusic(new Float32Array(rate * 3), rate), { bpm: null, energy: 0, mode: null, key: null, keyConfidence: 0, brightness: 0 });
  assert.deepEqual(detectKey(new Array(12).fill(1)), { key: null, mode: null, confidence: 0 });
});

test('a described link stands in for analysis', () => {
  assert.deepEqual(describedMusic({ pace: 'slow', energy: 'soft', mode: 'minor', genre: 'jazz', year: 1957 }),
    { bpm: 66, energy: 0.25, mode: 'minor', key: null, keyConfidence: 0.6, brightness: 0.25, genre: 'jazz', year: 1957 });
  assert.equal(describedMusic({ pace: 'fast', energy: '', mode: '', genre: 'electronic' }).energy, 0.8);
});
