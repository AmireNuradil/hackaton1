import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { folderFiles, zipFolder } from '../src/folder.js';
import { describedMusic } from '../src/music.js';
import { buildDay } from '../src/pipeline.js';

const photo = { palette: [[180, 120, 80]], weights: [1], light: 0.5, contrast: 0.2, warmth: 0.2, saturation: 0.4 };
const hostile = 'Вечер у окна. <script>alert(1)</script>';

function linkDay(text = hostile) {
  return buildDay({
    id: 'x', date: '2026-11-22', text,
    photos: [{ name: 'my photo.webp', blob: new Blob(['photo'], { type: 'image/webp' }) }],
    photoReadings: [photo],
    music: { source: 'link', link: 'https://example.org/song?a=1&b=2', name: 'example.org', title: 'Artist — Song', ...describedMusic({ pace: 'slow', energy: 'soft', mode: 'major' }) },
  });
}

test('a day folder holds entry, photos, song, memory, voice and rules under the day title', async () => {
  const day = linkDay();
  const files = await folderFiles(day, { video: { blob: new Blob(['video']), name: 'memory.webm' }, poster: new Blob(['png']) });
  const zip = unzipSync(new Uint8Array(await (await zipFolder(day.folder, files)).arrayBuffer()));
  const names = Object.keys(zip).sort();
  assert.equal(day.folder, '2026-11-22 Вечер у окна');
  assert.deepEqual(names, ['day.json', 'entry.txt', 'memory.html', 'memory.webm', 'photo-01.webp', 'poster.png', 'song-link.txt', 'voice.txt'].map((name) => `${day.folder}/${name}`));
  assert.equal(strFromU8(zip[`${day.folder}/entry.txt`]), hostile);
  const record = JSON.parse(strFromU8(zip[`${day.folder}/day.json`]));
  assert.equal(record.title, day.design.title);
  assert.equal(record.design.technique, day.design.technique);
  assert.equal(record.inputs.music.link, 'https://example.org/song?a=1&b=2');
  assert.ok(record.why.length >= 4);
  assert.match(strFromU8(zip[`${day.folder}/voice.txt`]), /Озвучка/);
});

test('the standalone player escapes the entry and the link', async () => {
  const files = await folderFiles(linkDay(), {});
  const page = strFromU8(files['memory.html']);
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page, /href="https:\/\/example\.org\/song\?a=1&amp;b=2"/);
});

test('an uploaded song is copied into the folder', async () => {
  const day = { ...linkDay('Тихий вечер.'), music: { source: 'file', name: 'track.mp3', blob: new Blob(['mp3'], { type: 'audio/mpeg' }), bpm: 70, energy: 0.3, mode: 'major', key: 'C мажор' } };
  const files = await folderFiles(day, {});
  assert.equal(strFromU8(files['song.mp3']), 'mp3');
  assert.ok(!('song-link.txt' in files));
  assert.match(strFromU8(files['memory.html']), /<audio controls src="song\.mp3">/);
});
