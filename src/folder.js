// The day folder: entry, photos, song, the finished memory (video + poster), voice script and the rules.
import { strToU8, zip } from 'fflate';
import { TECHNIQUES } from './system.js';

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const EXT = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/flac': 'flac',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
};

export function extension(media) {
  return EXT[media.blob?.type] ?? String(media.path ?? media.name ?? '').match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? 'bin';
}

export function fileNames(day, { video = 'memory.webm' } = {}) {
  return {
    photos: day.photos.map((photo, index) => `photo-${String(index + 1).padStart(2, '0')}.${extension(photo)}`),
    song: day.music.source === 'link' ? null : `song.${extension(day.music)}`,
    video,
  };
}

export function dayRecord(day, names) {
  const { design, music } = day;
  return {
    format: 'ton-dnya/day', version: 1,
    folder: day.folder, title: design.title, date: day.date, text: day.text,
    files: { entry: 'entry.txt', photos: names.photos, song: names.song ?? 'song-link.txt', memory: names.video, poster: 'poster.png', voice: 'voice.txt', player: 'memory.html' },
    inputs: {
      text: { lang: day.reading.lang, valence: day.reading.valence, arousal: day.reading.arousal, nostalgia: day.reading.nostalgia, season: day.reading.season, time: day.reading.time, words: day.reading.hits },
      photos: { ...day.photo, originals: day.photos.map((photo) => photo.name) },
      music: { source: music.source, title: music.title || null, link: music.link ?? null, bpm: music.bpm, energy: music.energy, mode: music.mode, key: music.key, genre: music.genre ?? null, year: music.year ?? null },
    },
    design: { technique: design.technique, techniqueName: TECHNIQUES[design.technique].name, mood: design.mood, palette: design.palette, accent: design.accent, rhythm: design.rhythm, motion: design.motion, texture: design.texture, type: design.type, voice: design.voice },
    why: design.reasons,
  };
}

export function memoryPage(day, names) {
  const { design, music } = day;
  const technique = TECHNIQUES[design.technique];
  const song = music.source === 'link'
    ? `<a href="${escape(music.link)}" rel="noopener noreferrer" target="_blank">Открыть песню ↗</a>`
    : `<audio controls src="${escape(names.song)}"></audio>`;
  const voice = JSON.stringify({ rate: design.voice.rate, pitch: design.voice.pitch, lang: day.reading.lang === 'ru' ? 'ru-RU' : 'en-US' });
  const reasons = design.reasons.map((reason) => `<li><b>${escape(reason.input)}.</b> ${escape(reason.cause)} → ${escape(reason.effect)}</li>`).join('');
  return `<!doctype html><html lang="${day.reading.lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(design.title)}</title>
<style>body{margin:0;background:#efe9dd;color:#26211e;font:16px/1.55 system-ui,sans-serif}main{width:min(560px,92%);margin:28px auto 60px}video,img{width:100%;aspect-ratio:4/5;display:block;border-radius:6px;background:#ddd;box-shadow:0 18px 50px #3a2a1a33}h1{font:500 34px/1.1 Georgia,serif;margin:22px 0 6px}p.meta{color:#6d6257;margin:0 0 14px}section{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0}button,a{font:inherit;color:inherit}button{border:1px solid #cdbfae;background:#fbf8f2;border-radius:8px;padding:.55rem .9rem;cursor:pointer}.text{white-space:pre-wrap}li{margin:.3rem 0}</style>
<main><video id="memory" src="${escape(names.video)}" poster="poster.png" controls playsinline></video>
<h1>${escape(design.title)}</h1><p class="meta">${escape(day.date)} · ${escape(technique.name)} · голос «${escape(design.voice.label)}»</p>
<section>${music.source === 'link' ? song : ''}<button id="speak" type="button">Слушать запись</button></section>
<details open><summary>Запись дня</summary><p class="text">${escape(day.text)}</p></details>
<details><summary>Почему этот день выглядит так</summary><ul>${reasons}</ul></details>
${music.source === 'link' ? '' : `<details><summary>Песня отдельно</summary>${song}</details>`}</main>
<script>
const voice = ${voice.replaceAll('<', '\\u003c')};
const button = document.getElementById('speak');
button.addEventListener('click', () => {
  if (!('speechSynthesis' in window)) { button.textContent = 'Озвучка недоступна в этом браузере'; return; }
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); button.textContent = 'Слушать запись'; return; }
  const text = document.querySelector('.text').textContent;
  const u = new SpeechSynthesisUtterance(text);
  Object.assign(u, voice);
  const match = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith(voice.lang.slice(0, 2)));
  if (match) u.voice = match;
  u.onend = () => { button.textContent = 'Слушать запись'; };
  speechSynthesis.speak(u);
  button.textContent = 'Остановить';
});
</script></html>`;
}

export function voiceScript(day) {
  const { voice } = day.design;
  return `${day.text}\n\n— Озвучка: «${voice.label}». Скорость ${voice.rate}, высота ${voice.pitch}. Голос синтезируется браузером при просмотре memory.html.\n`;
}

async function bytes(media, assetUrl) {
  if (media.blob) return new Uint8Array(await media.blob.arrayBuffer());
  const response = await fetch(assetUrl(media.path));
  if (!response.ok) throw new Error('Файл примера недоступен. Обновите страницу и попробуйте ещё раз.');
  return new Uint8Array(await response.arrayBuffer());
}

export async function folderFiles(day, { video, poster, assetUrl = (path) => path }) {
  const names = fileNames(day, { video: video?.name ?? 'memory.webm' });
  const files = {
    'entry.txt': strToU8(day.text),
    'day.json': strToU8(JSON.stringify(dayRecord(day, names), null, 2)),
    'memory.html': strToU8(memoryPage(day, names)),
    'voice.txt': strToU8(voiceScript(day)),
  };
  for (let index = 0; index < day.photos.length; index++) files[names.photos[index]] = await bytes(day.photos[index], assetUrl);
  if (names.song) files[names.song] = await bytes(day.music, assetUrl);
  else files['song-link.txt'] = strToU8(`${day.music.title ? `${day.music.title}\n` : ''}${day.music.link}\n`);
  if (video) files[names.video] = new Uint8Array(await video.blob.arrayBuffer());
  if (poster) files['poster.png'] = new Uint8Array(await poster.arrayBuffer());
  return files;
}

export async function zipFolder(folder, files) {
  const tree = Object.fromEntries(Object.entries(files).map(([name, data]) => [`${folder}/${name}`, data]));
  const data = await new Promise((resolve, reject) => zip(tree, { level: 0 }, (error, result) => (error ? reject(error) : resolve(result))));
  return new Blob([data], { type: 'application/zip' });
}

// Writes a real folder named after the day when the browser allows it (Chromium's File System Access API).
export async function writeFolder(parent, folder, files) {
  const directory = await parent.getDirectoryHandle(folder, { create: true });
  for (const [name, data] of Object.entries(files)) {
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }
  return directory;
}
