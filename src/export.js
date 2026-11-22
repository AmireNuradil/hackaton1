import { strToU8, zip } from 'fflate';
import { framing } from './compose.js';

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const assetExtensions = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/flac': 'flac',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
};

function mediaExtension(media) {
  return assetExtensions[media.blob?.type] ?? media.name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? 'bin';
}

function memoryPage(day, photos, audio) {
  const { design, text, date, music } = day;
  const musicControl = audio
    ? `<audio id="song" controls loop src="${audio}"></audio>`
    : `<a href="${escape(music.link)}" rel="noopener noreferrer" target="_blank">Open song</a>`;
  const scene = JSON.stringify({ count: design.shotCount, seconds: design.seconds, captions: design.captions ?? [design.phrase] })
    .replaceAll('<', '\\u003c');
  const shots = Array.from({ length: design.shotCount }, (_, index) => {
    const { position, motion } = framing(index, design.motion);
    const className = index === 0 ? 'shot active' : 'shot';
    return `<img class="${className}" src="${photos[index % photos.length]}" alt="" style="object-position:${position};--motion:${motion}">`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(design.title)}</title>
<style>
body{margin:0;background:#f9f5ee;color:#2a211d;font:16px/1.5 system-ui,sans-serif}main{width:min(900px,92%);margin:36px auto}h1{font:clamp(35px,7vw,64px)/1 Georgia,serif;margin:0 0 12px;overflow-wrap:anywhere}.frame{display:grid;position:relative;isolation:isolate;overflow:hidden;aspect-ratio:1.8;min-height:300px;align-items:end;border-radius:14px;background:rgb(${design.shadow});color:white}.frame::after{content:'';position:absolute;inset:0;background:linear-gradient(0deg,rgb(${design.shadow}),transparent 75%);z-index:-1}.frame img{width:100%;height:100%;object-fit:cover;position:absolute;z-index:-3;filter:saturate(${design.saturation}) brightness(${design.brightness});opacity:0}.frame .previous{opacity:1}.frame .active{opacity:1;z-index:-2;transition:opacity ${design.crossfade}ms}.playing .active{animation:var(--motion) var(--dwell) ease-in-out both}@keyframes drift{from{transform:scale(1.035) translateX(-.8%)}to{transform:scale(${design.zoom}) translateX(1%)}}@keyframes lift{from{transform:scale(1.055) translateY(1.4%)}to{transform:scale(${design.zoom}) translateY(-1.4%)}}@keyframes pulse{0%{transform:scale(1.10)}35%{transform:scale(${design.zoom}) translateX(-1.2%)}100%{transform:scale(1.075) translateX(1%)}}@keyframes recede{from{transform:scale(${design.zoom})}to{transform:scale(1.04) translateY(1.05%)}}.plate{padding:clamp(12px,5vw,42px)}.plate p{color:rgb(${design.accent});margin:0}section{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0}button,a{font:inherit}button{background:#a54236;color:white;padding:.6rem .9rem;border:0;border-radius:7px;cursor:pointer}.text{white-space:pre-wrap}@media(prefers-reduced-motion:reduce){.playing .active{animation:none;transition:none}}
</style><main><p>${escape(date)} · Afterimage</p><div class="frame" id="frame">${shots}<div class="plate"><h1>${escape(design.title)}</h1><p id="caption">${escape(design.phrase)}</p></div></div>
<section><button id="play" type="button">Play memory</button>${musicControl}</section><details><summary>Original entry</summary><p class="text">${escape(text)}</p></details></main>
<script>
const scene = ${scene};
const frame = document.getElementById('frame');
const button = document.getElementById('play');
const caption = document.getElementById('caption');
const shots = [...document.querySelectorAll('.shot')];
const song = document.getElementById('song');
const dwell = scene.seconds * 1000 / scene.count;
let interval;
let current = 0;
frame.style.setProperty('--dwell', dwell + 'ms');
function show(index) {
  shots.forEach(shot => shot.className = 'shot');
  if (current !== index) shots[current].classList.add('previous');
  shots[index].classList.add('active');
  caption.textContent = scene.captions[Math.floor(index * scene.captions.length / scene.count)];
  current = index;
}
function stop() { clearInterval(interval); interval = null; frame.classList.remove('playing'); button.textContent = 'Replay memory'; song?.pause(); }
button.addEventListener('click', () => {
  if (interval) { stop(); return; }
  let shot = 0;
  show(0); frame.classList.add('playing'); button.textContent = 'Stop';
  if (song) { song.currentTime = 0; song.play().catch(() => {}); }
  interval = setInterval(() => { shot++; if (shot >= scene.count) { stop(); return; } show(shot); }, dwell);
});
</script></html>`;
}

async function readAsset(media, assetUrl) {
  if (media.blob) return new Uint8Array(await media.blob.arrayBuffer());
  const response = await fetch(assetUrl(media.path));
  if (!response.ok) throw new Error('A sample asset is unavailable. Refresh and try the download again.');
  return new Uint8Array(await response.arrayBuffer());
}

export async function exportDay(day, assetUrl) {
  const title = Array.from(day.design.title).slice(0, 56).join('');
  const folder = `${day.date} ${title}`.replace(/[<>:"/\\|?*]/g, '').trim();
  const names = day.photos.map((photo, index) => `photo-${String(index + 1).padStart(2, '0')}.${mediaExtension(photo)}`);
  const audio = day.music.source !== 'link' ? `soundtrack.${mediaExtension({ ...day.music, name: day.music.path ?? day.music.name })}` : null;
  const files = {
    [`${folder}/entry.txt`]: strToU8(day.text),
    [`${folder}/memory.html`]: strToU8(memoryPage(day, names, audio)),
    [`${folder}/day.json`]: strToU8(JSON.stringify({ version: 1, date: day.date, title: day.design.title, originalFiles: day.photos.map((photo) => photo.name), media: names, soundtrack: audio ?? day.music.link, analysis: { photo: day.photo, music: { bpm: day.music.bpm, energy: day.music.energy, source: day.music.source } }, visual: day.design }, null, 2)),
  };
  for (let index = 0; index < day.photos.length; index++) files[`${folder}/${names[index]}`] = await readAsset(day.photos[index], assetUrl);
  if (audio) files[`${folder}/${audio}`] = await readAsset(day.music, assetUrl);
  else files[`${folder}/song-link.txt`] = strToU8(day.music.link);
  const bytes = await new Promise((resolve, reject) => zip(files, { level: 0 }, (error, result) => error ? reject(error) : resolve(result)));
  return { blob: new Blob([bytes], { type: 'application/zip' }), name: `${folder}.zip` };
}
