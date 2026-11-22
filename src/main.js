import '@fontsource-variable/cormorant-garamond/wght.css';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import '@fontsource-variable/caveat/wght.css';
import '@fontsource-variable/manrope/wght.css';
import './style.css';
import { folderFiles, writeFolder, zipFolder } from './folder.js';
import { analyzeAudio, loadImage, MAX_AUDIO_SIZE, MAX_PHOTO_SIZE, MAX_PHOTOS, readImage } from './media.js';
import { describedMusic, GENRES } from './music.js';
import { buildDay } from './pipeline.js';
import { createPainter, dateLine, loadFonts, posterTime } from './render.js';
import { SAMPLES } from './samples.js';
import { fetchDays, deleteDay, saveDay } from './store.js';
import { CONSTANTS, TECHNIQUES } from './system.js';
import { recordMemory, videoType } from './video.js';
import { canSpeak, speak } from './voice.js';

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const viewer = $('viewer');
const form = $('entry-form');
const audio = $('soundtrack');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const sampleUrl = (path) => new URL(`samples/${path}`, document.baseURI).href;

let days = [];
let storeError = false;
let selectedPhotos = [];
let previewUrls = [];
let busy = false;
let technique = 'all';
const posters = new Map();
const imageCache = new Map();

const view = { day: null, painter: null, frame: 0, start: 0, playing: false, muted: false, stopVoice: null, voiceOn: false };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function show(element, message) {
  element.textContent = message ?? '';
  element.hidden = !message;
}

function mediaSource(media) {
  return media.blob ?? sampleUrl(media.path);
}

async function imagesFor(day) {
  if (!imageCache.has(day.id)) imageCache.set(day.id, Promise.all(day.photos.map((photo) => loadImage(mediaSource(photo)))));
  return imageCache.get(day.id);
}

// Render scale for an on-screen canvas: its CSS width × pixel ratio, relative to the 1080 px page.
function screenScale(element) {
  const width = element.getBoundingClientRect().width || 540;
  return Math.min(1, Math.max(0.4, Math.ceil(width * (window.devicePixelRatio || 1) / 1080 * 20) / 20));
}

function numbers() {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  return new Map(ordered.map((day, index) => [day.id, index + 1]));
}

async function posterFor(day) {
  if (posters.has(day.id)) return posters.get(day.id);
  const promise = (async () => {
    if (day.poster) return URL.createObjectURL(day.poster);
    const canvas = document.createElement('canvas');
    const painter = await createPainter(canvas, day, await imagesFor(day), { number: numbers().get(day.id) });
    painter.draw(posterTime(day.design));
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return URL.createObjectURL(blob);
  })();
  posters.set(day.id, promise);
  return promise;
}

async function posterBlob(day) {
  const canvas = document.createElement('canvas');
  const painter = await createPainter(canvas, day, await imagesFor(day), { number: numbers().get(day.id) ?? days.length + 1 });
  painter.draw(posterTime(day.design));
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// ——— Samples: the same pipeline as the author's own days ———

async function sampleDay(sample) {
  const photos = sample.photos.map((path) => ({ path, name: path }));
  const images = await Promise.all(photos.map((photo) => loadImage(sampleUrl(photo.path))));
  const response = await fetch(sampleUrl(sample.song));
  const measured = await analyzeAudio(await response.arrayBuffer());
  const music = { source: 'sample', path: sample.song, name: sample.song, title: sample.title, genre: sample.genre, year: sample.year, ...measured };
  const day = buildDay({ id: sample.id, date: sample.date, text: sample.text, photos, photoReadings: images.map(readImage), music, created: 0, example: true });
  imageCache.set(day.id, Promise.resolve(images));
  return day;
}

// ——— Feed ———

function card(day, number) {
  const item = node('li', 'day');
  const button = node('button', 'day-button');
  button.type = 'button';
  button.dataset.day = day.id;
  const frame = node('span', 'day-poster');
  const image = node('img');
  image.alt = '';
  image.loading = 'lazy';
  posterFor(day).then((url) => { image.src = url; }).catch(() => {});
  frame.append(image);
  const meta = node('span', 'day-meta');
  meta.append(node('span', '', `№${String(number).padStart(2, '0')} · ${dateLine(day.date)}`), node('span', 'day-technique', TECHNIQUES[day.design.technique].short));
  const title = node('span', 'day-title', day.design.title);
  const folder = node('span', 'day-folder', day.folder);
  button.append(frame, meta, title, folder);
  button.addEventListener('click', () => openViewer(day));
  item.append(button);
  return item;
}

function renderChips() {
  const chips = [['all', 'Все приёмы'], ...Object.entries(TECHNIQUES).map(([id, t]) => [id, t.name])].map(([id, label]) => {
    const button = node('button', 'chip', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(id === technique));
    button.addEventListener('click', () => { technique = id; renderChips(); renderFeed(); });
    return button;
  });
  $('technique-filter').replaceChildren(...chips);
}

function renderFeed() {
  const filter = $('feed-filter').value;
  const query = $('feed-search').value.trim().toLocaleLowerCase('ru');
  const number = numbers();
  const list = [...days]
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created)
    .filter((day) => filter === 'all' || (filter === 'samples') === Boolean(day.example))
    .filter((day) => technique === 'all' || day.design.technique === technique)
    .filter((day) => !query || `${day.design.title} ${day.text} ${day.music.title ?? ''}`.toLocaleLowerCase('ru').includes(query));
  $('days').replaceChildren(...list.map((day) => card(day, number.get(day.id))));
  const own = days.filter((day) => !day.example).length;
  $('feed-count').textContent = `${days.length} ${plural(days.length, 'день', 'дня', 'дней')} · своих ${own}`;
  show($('feed-status'), storeError ? 'Хранилище браузера недоступно — примеры работают, но новые дни не сохранятся.' : list.length ? '' : filter === 'mine' && !own ? 'Здесь появятся ваши дни. Нажмите «Записать день».' : 'Ничего не нашлось.');
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderSystem() {
  $('constants').replaceChildren(...CONSTANTS.map((text) => node('li', '', text)));
  $('techniques').replaceChildren(...Object.values(TECHNIQUES).map((t) => {
    const item = node('li', 'technique');
    item.append(node('h4', '', t.name), node('p', 'technique-mood', `Когда: ${t.mood}`), node('p', '', t.why), node('p', 'muted small', `Референсы: ${t.references}. Голос: ${t.voice}.`));
    return item;
  }));
  $('song-genre').append(...Object.entries(GENRES).map(([id, genre]) => { const option = node('option', '', genre.label); option.value = id; return option; }));
}

// ——— Hero: the newest page plays silently ———

const hero = { painter: null, frame: 0, start: 0, id: null, visible: true, day: null };

// The hero page animates only while it is on screen and no day is open, so playback gets the whole frame budget.
function heroLoop(now) {
  if (!hero.painter || reduceMotion.matches || !hero.visible || viewer.open || document.hidden) { hero.frame = 0; return; }
  hero.painter.draw((now - hero.start) % hero.painter.duration);
  hero.frame = requestAnimationFrame(heroLoop);
}

function resumeHero() {
  if (!hero.frame && hero.painter) hero.frame = requestAnimationFrame(heroLoop);
}

async function renderHero() {
  const day = [...days].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created)[0];
  if (!day || hero.id === day.id) return;
  hero.id = day.id;
  cancelAnimationFrame(hero.frame);
  hero.frame = 0;
  hero.painter = await createPainter($('hero-canvas'), day, await imagesFor(day), { number: numbers().get(day.id), scale: screenScale($('hero-canvas')) });
  const caption = $('hero-caption');
  caption.replaceChildren(node('span', '', `Папка «${day.folder}»`), node('span', 'muted', ` · ${TECHNIQUES[day.design.technique].name}`));
  $('hero-page').onclick = () => openViewer(day);
  hero.start = performance.now();
  hero.painter.draw(posterTime(day.design));
  hero.frame = 0;
  resumeHero();
}

new IntersectionObserver(([entry]) => { hero.visible = entry.isIntersecting; resumeHero(); }).observe($('hero-canvas'));
document.addEventListener('visibilitychange', resumeHero);

// ——— Editor ———

function songSource() {
  return form.elements['song-source'].value;
}

function setSongSource() {
  const link = songSource() === 'link';
  $('song-link-group').hidden = !link;
  $('song-file-group').hidden = link;
}

function clearPreview() {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls = [];
  $('photo-preview').replaceChildren();
  $('photo-preview').hidden = true;
}

function openEditor() {
  if (busy) return;
  form.reset();
  const now = new Date();
  $('day-date').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  selectedPhotos = [];
  clearPreview();
  setSongSource();
  show($('form-error'), '');
  show($('form-progress'), '');
  editor.showModal();
  $('day-text').focus();
}

function selectPhotos() {
  clearPreview();
  const files = [...$('day-photos').files];
  const error = files.length > MAX_PHOTOS ? 'Можно до шести фотографий.' : files.some((file) => file.size > MAX_PHOTO_SIZE) ? 'Каждое фото — до 15 МБ.' : '';
  selectedPhotos = error ? [] : files;
  if (error) $('day-photos').value = '';
  show($('form-error'), error);
  for (const file of selectedPhotos) {
    const image = node('img');
    image.alt = file.name;
    image.src = URL.createObjectURL(file);
    previewUrls.push(image.src);
    $('photo-preview').append(image);
  }
  $('photo-preview').hidden = !selectedPhotos.length;
}

function songDetails() {
  const year = Number.parseInt($('song-year').value, 10);
  return {
    title: $('song-title').value.trim(),
    genre: $('song-genre').value || null,
    year: year >= 1900 && year <= 2030 ? year : null,
  };
}

async function createDay(event) {
  event.preventDefault();
  if (busy) return;
  const text = $('day-text').value.trim();
  const date = $('day-date').value;
  const progress = $('form-progress');
  if (!date || !text || !selectedPhotos.length) {
    show($('form-error'), 'Нужны дата, несколько слов о дне и хотя бы одно фото.');
    return;
  }
  const details = songDetails();
  let music;
  try {
    if (songSource() === 'link') {
      const url = new URL($('song-link').value.trim());
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
      if (!$('song-pace').value || !$('song-energy').value) {
        show($('form-error'), 'Опишите песню по ссылке: выберите темп и энергию.');
        return;
      }
      music = { source: 'link', link: url.href, name: url.hostname.replace(/^www\./, ''), ...details,
        ...describedMusic({ pace: $('song-pace').value, energy: $('song-energy').value, mode: $('song-mode').value, genre: details.genre, year: details.year }) };
    }
  } catch {
    show($('form-error'), 'Нужна публичная ссылка, начинающаяся с https://');
    return;
  }
  const file = $('song-file').files[0];
  if (!music && (!file || file.size > MAX_AUDIO_SIZE)) {
    show($('form-error'), file ? 'Аудиофайл больше 25 МБ.' : 'Добавьте песню: файл или ссылку.');
    return;
  }
  busy = true;
  const button = $('create-day');
  button.disabled = true;
  show($('form-error'), '');
  try {
    show(progress, 'Читаю запись и смотрю фотографии…');
    const images = await Promise.all(selectedPhotos.map(loadImage));
    const photoReadings = images.map(readImage);
    if (!music) {
      show(progress, 'Слушаю песню: темп, энергия, лад…');
      const measured = await analyzeAudio(file);
      music = { source: 'file', name: file.name, blob: file, ...details, title: details.title || file.name.replace(/\.[^.]+$/, ''), ...measured };
    }
    show(progress, 'Собираю страницу дня…');
    const id = crypto.randomUUID();
    const day = buildDay({ id, date, text, photos: selectedPhotos.map((photo) => ({ name: photo.name, blob: photo })), photoReadings, music });
    imageCache.set(id, Promise.resolve(images));
    days.push(day);
    day.poster = await posterBlob(day);
    try {
      await saveDay(day);
      storeError = false;
    } catch (error) {
      days = days.filter((entry) => entry.id !== id);
      throw error.name === 'QuotaExceededError' ? new Error('Хранилище браузера заполнено. Попробуйте фото поменьше или короче трек.') : error;
    }
    editor.close();
    $('feed-filter').value = 'all';
    technique = 'all';
    renderChips();
    renderFeed();
    renderHero();
    openViewer(day);
  } catch (error) {
    show($('form-error'), error.message || 'Не получилось сохранить день.');
  } finally {
    busy = false;
    button.disabled = false;
    show(progress, '');
  }
}

// ——— Viewer ———

function stopVoice() {
  view.stopVoice?.();
  view.stopVoice = null;
  view.voiceOn = false;
  $('voice-day').setAttribute('aria-pressed', 'false');
  $('voice-day').textContent = 'Озвучка';
  audio.volume = 1;
}

function toggleVoice() {
  if (view.voiceOn) { stopVoice(); return; }
  const day = view.day;
  view.stopVoice = speak(day.text, day.design.voice, day.reading.lang, () => { if (view.day === day) stopVoice(); });
  if (!view.stopVoice) { show($('viewer-status'), 'Озвучка недоступна в этом браузере.'); return; }
  view.voiceOn = true;
  audio.volume = 0.35;
  $('voice-day').setAttribute('aria-pressed', 'true');
  $('voice-day').textContent = 'Остановить голос';
}

function paint(now) {
  if (!view.playing) return;
  const time = now - view.start;
  view.painter.draw(time);
  if (time >= view.painter.duration) {
    stopPlayback('↻ Ещё раз');
    return;
  }
  view.frame = requestAnimationFrame(paint);
}

function stopPlayback(label = '▶ Смотреть') {
  view.playing = false;
  cancelAnimationFrame(view.frame);
  audio.pause();
  $('play-day').textContent = label;
}

function startPlayback() {
  if (view.playing) { stopPlayback('▶ Смотреть'); return; }
  if (!view.painter) return;
  view.playing = true;
  view.start = performance.now();
  $('play-day').textContent = '❚❚ Стоп';
  if (view.day.music.source !== 'link') {
    audio.currentTime = 0;
    audio.play().catch((error) => { if (error.name !== 'AbortError' && view.playing) show($('viewer-status'), 'Звук не запустился. Нажмите «Стоп», затем «Смотреть».'); });
  }
  view.frame = requestAnimationFrame(paint);
}

let audioUrl = null;

async function openViewer(day) {
  if (viewer.open) closeViewer();
  view.day = day;
  const { design, music } = day;
  $('viewer-date').textContent = `№${String(numbers().get(day.id)).padStart(2, '0')} · ${dateLine(day.date)}`;
  $('viewer-title').textContent = design.title;
  $('viewer-folder').textContent = day.folder;
  $('viewer-text').textContent = day.text;
  const t = TECHNIQUES[design.technique];
  $('viewer-technique').textContent = `${t.name} · ${t.short}`;
  $('viewer-why').textContent = t.why;
  $('viewer-references').textContent = `Референсы: ${t.references}`;
  $('viewer-reasons').replaceChildren(...design.reasons.flatMap((reason) => {
    const dd = node('dd');
    dd.append(node('span', 'cause', reason.cause), node('span', 'effect', reason.effect));
    return [node('dt', '', reason.input), dd];
  }));
  $('delete-day').hidden = Boolean(day.example);
  $('voice-day').hidden = !canSpeak();
  const linked = music.source === 'link';
  $('open-song').hidden = !linked;
  $('mute-day').hidden = linked;
  if (linked) $('open-song').href = music.link;
  else {
    audioUrl = music.blob ? URL.createObjectURL(music.blob) : sampleUrl(music.path);
    audio.src = audioUrl;
    audio.loop = true;
    audio.muted = view.muted;
  }
  $('save-video').disabled = !videoType();
  $('save-video').checked = Boolean(videoType());
  show($('viewer-status'), '');
  $('play-day').textContent = '▶ Смотреть';
  viewer.showModal();
  $('play-day').focus();
  const canvas = $('viewer-canvas');
  canvas.setAttribute('aria-label', `Страница дня «${design.title}», ${t.name.toLowerCase()}. ${design.captions.join(' ')}`);
  // Painting a page takes a moment; Play stays disabled until it is ready instead of drawing nothing.
  $('play-day').disabled = true;
  $('viewer-stage').setAttribute('aria-busy', 'true');
  const painter = await createPainter(canvas, day, await imagesFor(day), { number: numbers().get(day.id), scale: screenScale(canvas) });
  if (view.day !== day) return;
  view.painter = painter;
  $('play-day').disabled = false;
  $('viewer-stage').removeAttribute('aria-busy');
  painter.draw(posterTime(design));
}

function closeViewer() {
  stopPlayback();
  stopVoice();
  audio.removeAttribute('src');
  audio.load();
  if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
  view.day = null;
  view.painter = null;
  if (viewer.open) viewer.close();
  resumeHero();
}

async function mediaBytes(media) {
  if (media.blob) return media.blob.arrayBuffer();
  const response = await fetch(sampleUrl(media.path));
  return response.arrayBuffer();
}

async function saveFolder() {
  const day = view.day;
  if (!day || busy) return;
  const status = $('viewer-status');
  const button = $('save-day');
  let parent = null;
  if ('showDirectoryPicker' in window) {
    try {
      parent = await window.showDirectoryPicker({ id: 'ton-dnya', mode: 'readwrite', startIn: 'documents' });
    } catch (error) {
      if (error.name === 'AbortError') return;
      parent = null;
    }
  }
  busy = true;
  button.disabled = true;
  try {
    const wasPlaying = view.playing;
    if (wasPlaying) stopPlayback();
    let video = null;
    if ($('save-video').checked && videoType()) {
      const bytes = day.music.source === 'link' ? null : await mediaBytes(day.music);
      video = await recordMemory(day, await imagesFor(day), bytes, numbers().get(day.id), (fraction) => {
        show(status, `Записываю видео страницы: ${Math.round(fraction * 100)}% — не закрывайте вкладку`);
      });
    }
    show(status, 'Собираю папку…');
    const files = await folderFiles(day, { video, poster: await posterBlob(day), assetUrl: sampleUrl });
    if (parent) {
      await writeFolder(parent, day.folder, files);
      show(status, `Папка «${day.folder}» сохранена: ${Object.keys(files).length} файлов.`);
    } else {
      const blob = await zipFolder(day.folder, files);
      const url = URL.createObjectURL(blob);
      const link = node('a');
      link.href = url;
      link.download = `${day.folder}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      show(status, `Папка «${day.folder}» скачана архивом: ${Object.keys(files).length} файлов.`);
    }
    if (view.painter) view.painter.draw(posterTime(day.design));
  } catch (error) {
    show(status, error.message || 'Не получилось сохранить папку.');
  } finally {
    busy = false;
    button.disabled = false;
  }
}

async function removeDay() {
  const day = view.day;
  if (!day || day.example || !confirm(`Удалить «${day.design.title}» из дневника? Это нельзя отменить.`)) return;
  await deleteDay(day.id);
  days = days.filter((entry) => entry.id !== day.id);
  posters.delete(day.id);
  imageCache.delete(day.id);
  closeViewer();
  hero.id = null;
  renderFeed();
  renderHero();
}

// ——— Wiring ———

for (const button of document.querySelectorAll('.new-day')) button.addEventListener('click', openEditor);
for (const button of document.querySelectorAll('.close-editor')) button.addEventListener('click', () => { if (!busy) editor.close(); });
editor.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
editor.addEventListener('close', clearPreview);
form.addEventListener('submit', createDay);
for (const radio of form.elements['song-source']) radio.addEventListener('change', setSongSource);
$('day-photos').addEventListener('change', selectPhotos);
$('feed-filter').addEventListener('change', renderFeed);
$('feed-search').addEventListener('input', renderFeed);
$('close-viewer').addEventListener('click', closeViewer);
viewer.addEventListener('close', () => { if (view.day) closeViewer(); });
viewer.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
$('play-day').addEventListener('click', startPlayback);
$('voice-day').addEventListener('click', toggleVoice);
$('mute-day').addEventListener('click', () => {
  view.muted = !view.muted;
  audio.muted = view.muted;
  $('mute-day').setAttribute('aria-pressed', String(view.muted));
  $('mute-day').textContent = view.muted ? 'Со звуком' : 'Без звука';
});
$('save-day').addEventListener('click', saveFolder);
$('delete-day').addEventListener('click', removeDay);
$('hero-page').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('hero-page').click(); });

async function start() {
  renderSystem();
  renderChips();
  await loadFonts();
  const saved = fetchDays().catch(() => { storeError = true; return []; });
  const samples = await Promise.all(SAMPLES.map((sample) => sampleDay(sample).catch((error) => { console.error(sample.id, error); return null; })));
  days = [...samples.filter(Boolean), ...await saved];
  document.body.dataset.ready = 'true';
  renderFeed();
  renderHero();
}

start();
